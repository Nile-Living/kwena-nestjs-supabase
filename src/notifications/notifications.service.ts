// src/notifications/notifications.service.ts
import {
    Injectable,
    Inject,
    Logger,
    NotFoundException,
    InternalServerErrorException,
  } from '@nestjs/common';
  import { SupabaseClient } from '@supabase/supabase-js';
  import { SUPABASE_CLIENT } from '../supabase/supabase.constants';
  import { Cron, CronExpression } from '@nestjs/schedule';
  import { CreateNotificationDto } from './dto/create-notification.dto';
  import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
  import { QueryNotificationsDto } from './dto/query-notifications.dto';
  import { Expo, ExpoPushMessage } from 'expo-server-sdk';
  
  export interface Notification {
    id: string;
    user_id: string;
    type: string;
    title: string;
    body: string;
    data: Record<string, any>;
    read_at: string | null;
    created_at: string;
    updated_at: string;
  }
  
  export interface NotificationsResponse {
    notifications: Notification[];
    total: number;
    page: number;
    pageSize: number;
    unreadCount: number;
  }
  
  @Injectable()
  export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);
    private expo = new Expo();
  
    constructor(
      @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    ) {}
  
    // Check for expiring promotions every hour
    @Cron(CronExpression.EVERY_HOUR)
    async checkExpiringPromotions() {
      this.logger.log('Checking for expiring promotions...');
      
      try {
        // Find promotions expiring in the next 24 hours that haven't been notified
        const oneDayFromNow = new Date();
        oneDayFromNow.setHours(oneDayFromNow.getHours() + 24);
        
        const { data: expiringPromotions, error } = await this.supabase
          .from('promotions')
          .select(`
            id,
            property_id,
            promotion_expires_at,
            properties!inner(
              id,
              title,
              user_id,
              profiles!inner(
                id,
                role,
                full_name
              )
            )
          `)
          .eq('payment_status', 'successful')
          .lte('promotion_expires_at', oneDayFromNow.toISOString())
          .gte('promotion_expires_at', new Date().toISOString());
  
        if (error) {
          this.logger.error(`Error fetching expiring promotions: ${error.message}`);
          return;
        }
  
        for (const promotion of expiringPromotions || []) {
          // Check if we already sent a notification for this promotion
          const { data: existingNotification } = await this.supabase
            .from('notifications')
            .select('id')
            .eq('type', 'promotion_expiring')
            .eq('data->promotion_id', promotion.id)
            .maybeSingle();
  
          if (!existingNotification) {
            const property = promotion.properties;
            const userProfile = property[0].profiles;
            
            if (userProfile && userProfile[0].role === 'agent') {
              const expiresAt = new Date(promotion.promotion_expires_at);
              const hoursUntilExpiry = Math.ceil(
                (expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60)
              );
  
              await this.createNotification({
                user_id: property[0].user_id,
                type: 'promotion_expiring',
                title: 'Promotion Expiring Soon',
                body: `Your promotion for "${promotion.properties[0]?.title}" expires in ${hoursUntilExpiry} hours`,
                data: {
                  promotion_id: promotion.id,
                  property_id: promotion.property_id,
                  property_title: promotion.properties[0]?.title,
                  expires_at: promotion.promotion_expires_at,
                },
              });
  
              this.logger.log(`Notification sent to agent ${userProfile[0].full_name || 'Unknown'} for property: ${property[0].title}`);
            } else {
              this.logger.log(`Skipping notification for property ${property[0].title} - owner is not an agent (role: ${userProfile[0]?.role || 'unknown'})`);
            }
          }
        }
      } catch (error) {
        this.logger.error('Error in checkExpiringPromotions:', error);
      }
    }
  
    async createNotification(dto: CreateNotificationDto): Promise<Notification> {
      // Verify the user is an agent before creating notification
      const { data: userProfile, error: profileError } = await this.supabase
        .from('profiles')
        .select('role')
        .eq('id', dto.user_id)
        .single();
  
      if (profileError) {
        this.logger.error(`Error fetching user profile for notification: ${profileError.message}`);
        throw new InternalServerErrorException('Failed to verify user profile');
      }
  
      if (userProfile.role !== 'agent') {
        this.logger.warn(`Attempted to create notification for non-agent user: ${dto.user_id}`);
        throw new InternalServerErrorException('Notifications are only available for agents');
      }
  
      const { data, error } = await this.supabase
        .from('notifications')
        .insert({
          user_id: dto.user_id,
          type: dto.type,
          title: dto.title,
          body: dto.body,
          data: dto.data || {},
        })
        .select()
        .single();
  
      if (error) {
        this.logger.error(`Error creating notification: ${error.message}`);
        throw new InternalServerErrorException('Failed to create notification');
      }
  
      // Send push notification
      await this.sendPushNotification(dto.user_id, dto.title, dto.body, dto.data);
  
      return data;
    }
  
    async getUserNotifications(
      userId: string,
      query: QueryNotificationsDto,
    ): Promise<NotificationsResponse> {
      // Verify the user is an agent
      const { data: userProfile, error: profileError } = await this.supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
  
      if (profileError) {
        this.logger.error(`Error fetching user profile: ${profileError.message}`);
        throw new InternalServerErrorException('Failed to verify user profile');
      }
  
      if (userProfile.role !== 'agent') {
        throw new InternalServerErrorException('Notifications are only available for agents');
      }
  
      const { page = 1, pageSize = 20, unreadOnly = false } = query;
      const offset = (page - 1) * pageSize;
  
      let queryBuilder = this.supabase
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
  
      if (unreadOnly) {
        queryBuilder = queryBuilder.is('read_at', null);
      }
  
      const { data: notifications, error, count } = await queryBuilder;
  
      if (error) {
        this.logger.error(`Error fetching notifications: ${error.message}`);
        throw new InternalServerErrorException('Failed to fetch notifications');
      }
  
      // Get unread count
      const { count: unreadCount, error: unreadError } = await this.supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null);
  
      if (unreadError) {
        this.logger.error(`Error fetching unread count: ${unreadError.message}`);
      }
  
      return {
        notifications: notifications || [],
        total: count || 0,
        page,
        pageSize,
        unreadCount: unreadCount || 0,
      };
    }
  
    async markAsRead(userId: string, notificationId: string): Promise<void> {
      // Verify the user is an agent
      const { data: userProfile, error: profileError } = await this.supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
  
      if (profileError || userProfile.role !== 'agent') {
        throw new InternalServerErrorException('Unauthorized access to notifications');
      }
  
      const { error } = await this.supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId)
        .eq('user_id', userId);
  
      if (error) {
        this.logger.error(`Error marking notification as read: ${error.message}`);
        throw new InternalServerErrorException('Failed to mark notification as read');
      }
    }
  
    async markAllAsRead(userId: string): Promise<void> {
      // Verify the user is an agent
      const { data: userProfile, error: profileError } = await this.supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
  
      if (profileError || userProfile.role !== 'agent') {
        throw new InternalServerErrorException('Unauthorized access to notifications');
      }
  
      const { error } = await this.supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('read_at', null);
  
      if (error) {
        this.logger.error(`Error marking all notifications as read: ${error.message}`);
        throw new InternalServerErrorException('Failed to mark all notifications as read');
      }
    }
  
    async registerDeviceToken(userId: string, dto: RegisterDeviceTokenDto): Promise<void> {
      // Verify the user is an agent
      const { data: userProfile, error: profileError } = await this.supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
  
      if (profileError || userProfile.role !== 'agent') {
        throw new InternalServerErrorException('Device token registration is only available for agents');
      }
  
      // Delete existing token for this user and platform
      await this.supabase
        .from('device_tokens')
        .delete()
        .eq('user_id', userId)
        .eq('platform', dto.platform);
  
      // Insert new token
      const { error } = await this.supabase
        .from('device_tokens')
        .insert({
          user_id: userId,
          token: dto.token,
          platform: dto.platform,
        });
  
      if (error) {
        this.logger.error(`Error registering device token: ${error.message}`);
        throw new InternalServerErrorException('Failed to register device token');
      }
    }
  
    private async sendPushNotification(
      userId: string,
      title: string,
      body: string,
      data?: Record<string, any>,
    ): Promise<void> {
      try {
        // Get user's device tokens
        const { data: deviceTokens, error } = await this.supabase
          .from('device_tokens')
          .select('token')
          .eq('user_id', userId);
  
        if (error || !deviceTokens?.length) {
          this.logger.log(`No device tokens found for user ${userId}`);
          return;
        }
  
        const messages: ExpoPushMessage[] = deviceTokens
          .filter(dt => Expo.isExpoPushToken(dt.token))
          .map(dt => ({
            to: dt.token,
            sound: 'default',
            title,
            body,
            data: data || {},
          }));
  
        if (messages.length === 0) {
          this.logger.log(`No valid Expo push tokens for user ${userId}`);
          return;
        }
  
        const chunks = this.expo.chunkPushNotifications(messages);
        
        for (const chunk of chunks) {
          try {
            const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
            this.logger.log(`Sent push notification chunk: ${JSON.stringify(ticketChunk)}`);
          } catch (error) {
            this.logger.error(`Error sending push notification chunk:`, error);
          }
        }
      } catch (error) {
        this.logger.error(`Error in sendPushNotification:`, error);
      }
    }
  }
  