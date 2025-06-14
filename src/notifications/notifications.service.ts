import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';
import { UpdateSavedSearchDto } from './dto/update-saved-search.dto';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { ConfigService } from '@nestjs/config';

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

interface PromotionWithProperty {
  id: string;
  property_id: string;
  promotion_expires_at: string;
  properties: {
    id: string;
    title: string;
    user_id: string;
  };
}

export interface SavedSearch {
  id: string;
  user_id: string;
  name: string;
  criteria: Record<string, any>;
  is_active: boolean;
  notification_enabled: boolean;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private expo = new Expo();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiringPromotions() {
    this.logger.log('Checking for expiring promotions...');

    try {
      const oneDayFromNow = new Date();
      oneDayFromNow.setHours(oneDayFromNow.getHours() + 24);

      this.logger.log(
        `Looking for promotions expiring between now and ${oneDayFromNow.toISOString()}`,
      );

      const { data: expiringPromotions, error } = (await this.supabase
        .from('promotions')
        .select(
          `
            id,
            property_id,
            promotion_expires_at,
            properties!inner(
              id,
              title,
              user_id
            )
          `,
        )
        .eq('payment_status', 'successful')
        .lte('promotion_expires_at', oneDayFromNow.toISOString())
        .gte('promotion_expires_at', new Date().toISOString())) as {
        data: PromotionWithProperty[] | null;
        error: any;
      };

      if (error) {
        this.logger.error(
          `Error fetching expiring promotions: ${error.message}`,
        );
        return;
      }

      this.logger.log(
        `Found ${expiringPromotions?.length || 0} expiring promotions`,
      );

      for (const promotion of expiringPromotions || []) {
        this.logger.log(`Processing promotion ${promotion.id}`);

        if (!promotion.properties || typeof promotion.properties !== 'object') {
          this.logger.error(
            `No properties data found for promotion ${promotion.id}. Properties: ${JSON.stringify(
              promotion.properties,
            )}`,
          );
          continue;
        }

        const property = promotion.properties;

        if (!property.title || !property.user_id) {
          this.logger.error(
            `Invalid property data for promotion ${
              promotion.id
            }. Property: ${JSON.stringify(property)}`,
          );
          continue;
        }

        this.logger.log(
          `Processing promotion ${promotion.id} for property ${property.title}`,
        );

        const { data: existingNotification, error: notificationCheckError } =
          await this.supabase
            .from('notifications')
            .select('id')
            .eq('type', 'promotion_expiring')
            .contains('data', { promotion_id: promotion.id })
            .maybeSingle();

        if (notificationCheckError) {
          this.logger.error(
            `Error checking existing notifications: ${notificationCheckError.message}`,
          );
          continue;
        }

        if (existingNotification) {
          this.logger.log(
            `Notification already exists for promotion ${promotion.id}`,
          );
          continue;
        }

        this.logger.log(
          `No existing notification found, fetching user profile for ${property.user_id}`,
        );

        const { data: userProfile, error: profileError } = await this.supabase
          .from('profiles')
          .select('id, role, full_name')
          .eq('id', property.user_id)
          .maybeSingle();

        if (profileError) {
          this.logger.error(
            `Database error fetching user profile for promotion ${promotion.id}: ${profileError.message}`,
          );
          continue;
        }

        if (!userProfile) {
          this.logger.warn(
            `Skipping promotion ${promotion.id}: User profile with ID ${property.user_id} not found.`,
          );
          continue;
        }

        this.logger.log(
          `User profile found: role=${userProfile?.role}, name=${userProfile?.full_name}`,
        );

        if (userProfile && userProfile.role === 'agent') {
          const expiresAt = new Date(promotion.promotion_expires_at);
          const hoursUntilExpiry = Math.ceil(
            (expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60),
          );

          this.logger.log(
            `Creating notification for agent. Hours until expiry: ${hoursUntilExpiry}`,
          );

          try {
            await this.createNotification({
              user_id: property.user_id,
              type: 'promotion_expiring',
              title: 'Promotion Expiring Soon',
              body: `Your promotion for "${property.title}" expires in ${hoursUntilExpiry} hours`,
              data: {
                promotion_id: promotion.id,
                property_id: promotion.property_id,
                property_title: property.title,
                expires_at: promotion.promotion_expires_at,
              },
            });

            this.logger.log(
              `Notification created successfully for agent ${
                userProfile.full_name || 'Unknown'
              } for property: ${property.title}`,
            );
          } catch (notificationError) {
            this.logger.error(
              `Failed to create notification: ${notificationError.message}`,
            );
            this.logger.error(`Notification error details:`, notificationError);
          }
        } else {
          this.logger.log(
            `Skipping notification for property ${property.title} - owner is not an agent (role: ${
              userProfile?.role || 'unknown'
            })`,
          );
        }
      }
    } catch (error) {
      this.logger.error('Error in checkExpiringPromotions:', error);
      this.logger.error('Full error details:', error);
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkNewPropertiesForSavedSearches() {
    this.logger.log('Checking new properties against saved searches...');

    try {
      const fifteenMinutesAgo = new Date();
      fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);

      const { data: newProperties, error: propertiesError } =
        await this.supabase
          .from('properties_view')
          .select('*')
          .gte('created_at', fifteenMinutesAgo.toISOString())
          .eq('status', 'available');

      if (propertiesError) {
        this.logger.error(
          `Error fetching new properties: ${propertiesError.message}`,
        );
        return;
      }

      if (!newProperties || newProperties.length === 0) {
        this.logger.log('No new properties found');
        return;
      }

      this.logger.log(`Found ${newProperties.length} new properties`);

      const { data: savedSearches, error: searchesError } = await this.supabase
        .from('saved_searches')
        .select('*')
        .eq('is_active', true)
        .eq('notification_enabled', true);

      if (searchesError) {
        this.logger.error(
          `Error fetching saved searches: ${searchesError.message}`,
        );
        return;
      }

      if (!savedSearches || savedSearches.length === 0) {
        this.logger.log('No active saved searches found');
        return;
      }

      const userIds = [
        ...new Set(savedSearches.map((search) => search.user_id)),
      ];
      const { data: userProfiles, error: profilesError } = await this.supabase
        .from('profiles')
        .select('id, role')
        .in('id', userIds)
        .eq('role', 'user');

      if (profilesError) {
        this.logger.error(
          `Error fetching user profiles: ${profilesError.message}`,
        );
        return;
      }

      const { data: userSubscriptions, error: subscriptionsError } =
        await this.supabase
          .from('user_subscriptions')
          .select('user_id, status, expires_at')
          .in('user_id', userIds)
          .eq('status', 'active')
          .gte('expires_at', new Date().toISOString());

      if (subscriptionsError) {
        this.logger.error(
          `Error fetching user subscriptions: ${subscriptionsError.message}`,
        );
        return;
      }

      const profilesMap = new Map(userProfiles?.map((p) => [p.id, p]) || []);
      const subscriptionsMap = new Map(
        userSubscriptions?.map((s) => [s.user_id, s]) || [],
      );

      const eligibleSavedSearches = savedSearches.filter((search) => {
        const profile = profilesMap.get(search.user_id);
        const subscription = subscriptionsMap.get(search.user_id);
        return profile?.role === 'user' && subscription?.status === 'active';
      });

      if (eligibleSavedSearches.length === 0) {
        this.logger.log('No active saved searches from subscribed users found');
        return;
      }

      this.logger.log(
        `Found ${eligibleSavedSearches.length} eligible saved searches from subscribed users`,
      );

      for (const property of newProperties) {
        for (const savedSearch of eligibleSavedSearches) {
          if (this.propertyMatchesCriteria(property, savedSearch.criteria)) {
            const { data: existingNotification } = await this.supabase
              .from('search_notifications')
              .select('id')
              .eq('saved_search_id', savedSearch.id)
              .eq('property_id', property.id)
              .maybeSingle();

            if (!existingNotification) {
              await this.notifyUserAboutMatch(savedSearch, property);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error in checkNewPropertiesForSavedSearches:', error);
    }
  }

  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    const { data: userProfile, error: profileError } = await this.supabase
      .from('profiles')
      .select('role')
      .eq('id', dto.user_id)
      .maybeSingle();

    if (profileError) {
      this.logger.error(
        `Error fetching user profile for notification: ${profileError.message}`,
      );
      throw new InternalServerErrorException('Failed to verify user profile');
    }

    if (!userProfile || userProfile.role !== 'agent') {
      this.logger.warn(
        `Attempted to create notification for non-agent user: ${dto.user_id}`,
      );
      throw new InternalServerErrorException(
        'Notifications are only available for agents',
      );
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

    await this.sendPushNotification(dto.user_id, dto.title, dto.body, dto.data);

    return data;
  }

  async createNotificationForUser(dto: {
    user_id: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<void> {
    const { data: userProfile, error: profileError } = await this.supabase
      .from('profiles')
      .select('role')
      .eq('id', dto.user_id)
      .maybeSingle();

    if (profileError) {
      this.logger.error(`Error fetching user profile: ${profileError.message}`);
      throw new InternalServerErrorException('Failed to verify user profile');
    }

    if (!userProfile || userProfile.role !== 'user') {
      this.logger.warn(
        `Attempted to create user notification for non-user: ${dto.user_id}`,
      );
      return;
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
      this.logger.error(`Error creating user notification: ${error.message}`);
      throw new InternalServerErrorException('Failed to create notification');
    }

    await this.sendPushNotification(dto.user_id, dto.title, dto.body, dto.data);
  }

  async getUserNotifications(
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<NotificationsResponse> {
    const { data: userProfile, error: profileError } = await this.supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      this.logger.error(`Error fetching user profile: ${profileError.message}`);
      throw new InternalServerErrorException('Failed to verify user profile');
    }

    if (!userProfile || !['user', 'agent'].includes(userProfile.role)) {
      throw new InternalServerErrorException(
        'Invalid user role for notifications',
      );
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
    const { data: userProfile, error: profileError } = await this.supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (
      profileError ||
      !userProfile ||
      !['user', 'agent'].includes(userProfile.role)
    ) {
      throw new InternalServerErrorException(
        'Unauthorized access to notifications',
      );
    }

    const { error } = await this.supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Error marking notification as read: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to mark notification as read',
      );
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    const { data: userProfile, error: profileError } = await this.supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (
      profileError ||
      !userProfile ||
      !['user', 'agent'].includes(userProfile.role)
    ) {
      throw new InternalServerErrorException(
        'Unauthorized access to notifications',
      );
    }

    const { error } = await this.supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);

    if (error) {
      this.logger.error(
        `Error marking all notifications as read: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to mark all notifications as read',
      );
    }
  }

  async createSavedSearch(
    userId: string,
    dto: CreateSavedSearchDto,
  ): Promise<SavedSearch> {
    const isSubscribed =
      await this.subscriptionsService.isUserSubscribed(userId);
    if (!isSubscribed) {
      throw new BadRequestException(
        'You need an active subscription to save searches',
      );
    }

    const canSaveMore =
      await this.subscriptionsService.canUserSaveMoreSearches(userId);
    if (!canSaveMore) {
      const features =
        await this.subscriptionsService.getUserSubscriptionFeatures(userId);
      throw new BadRequestException(
        `You have reached your saved search limit (${
          features?.max_saved_searches || 0
        }). Upgrade your subscription to save more searches.`,
      );
    }

    const { data, error } = await this.supabase
      .from('saved_searches')
      .insert({
        user_id: userId,
        name: dto.name,
        criteria: dto.criteria,
        notification_enabled: dto.notification_enabled ?? true,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating saved search: ${error.message}`);
      throw new InternalServerErrorException('Failed to create saved search');
    }

    return data;
  }

  async getUserSavedSearches(userId: string): Promise<SavedSearch[]> {
    const { data, error } = await this.supabase
      .from('saved_searches')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching saved searches: ${error.message}`);
      throw new InternalServerErrorException('Failed to fetch saved searches');
    }

    return data || [];
  }

  async updateSavedSearch(
    userId: string,
    searchId: string,
    dto: UpdateSavedSearchDto,
  ): Promise<SavedSearch> {
    const { data, error } = await this.supabase
      .from('saved_searches')
      .update({
        ...dto,
        updated_at: new Date().toISOString(),
      })
      .eq('id', searchId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating saved search: ${error.message}`);
      throw new InternalServerErrorException('Failed to update saved search');
    }

    if (!data) {
      throw new NotFoundException('Saved search not found');
    }

    return data;
  }

  async deleteSavedSearch(userId: string, searchId: string): Promise<void> {
    const { error } = await this.supabase
      .from('saved_searches')
      .delete()
      .eq('id', searchId)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Error deleting saved search: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete saved search');
    }
  }

  async registerDeviceToken(
    userIdFromJwt: string,
    dto: RegisterDeviceTokenDto,
    jwt: string,
  ): Promise<void> {
    this.logger.log(
      `Registering device token for JWT_userId: ${userIdFromJwt}, token: ${dto.token}`,
    );

    const serviceRoleKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    if (!serviceRoleKey) {
      this.logger.error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
      throw new InternalServerErrorException('Server configuration error.');
    }

    try {
      await this.supabase.auth.setSession({
        access_token: jwt,
        refresh_token: '',
      });
      this.logger.log(`Temporarily set auth context for user ${userIdFromJwt}`);

      const { data: userProfile, error: profileError } = await this.supabase
        .from('profiles')
        .select('id, role')
        .eq('id', userIdFromJwt)
        .maybeSingle();

      if (profileError) {
        this.logger.error(
          `Profile fetch error for JWT_userId ${userIdFromJwt}: ${profileError?.message}`,
        );
        throw new InternalServerErrorException(
          'Failed to verify user profile for device token registration.',
        );
      }

      if (!userProfile) {
        this.logger.error(
          `Profile not found for JWT_userId ${userIdFromJwt}.`,
        );
        throw new InternalServerErrorException(
          'User profile not found for device token registration.',
        );
      }

      this.logger.log(
        `User profile fetched: ID=${userProfile.id}, Role=${userProfile.role}.`,
      );

      if (!['user', 'agent'].includes(userProfile.role)) {
        this.logger.error(
          `Invalid role '${userProfile.role}' for user ${userProfile.id} during device token registration.`,
        );
        throw new InternalServerErrorException(
          'Invalid user role for device token registration.',
        );
      }

      const upsertPayload = {
        user_id: userProfile.id,
        token: dto.token,
        platform: dto.platform,
        updated_at: new Date().toISOString(),
      };
      this.logger.log(
        `Upserting to device_tokens with payload: ${JSON.stringify(
          upsertPayload,
        )}`,
      );

      const { error: upsertError } = await this.supabase
        .from('device_tokens')
        .upsert(upsertPayload, {
          onConflict: 'token',
          ignoreDuplicates: false,
        });

      if (upsertError) {
        this.logger.error(
          `Error registering device token for user ${userProfile.id}: ${upsertError.message}`,
          upsertError.stack,
        );
        this.logger.error(
          `Upsert error details: code=${upsertError.code}, details=${upsertError.details}, hint=${upsertError.hint}`,
        );
        throw new InternalServerErrorException(
          `Failed to register device token: ${upsertError.message}`,
        );
      }

      this.logger.log(
        `Device token successfully registered for user ${userProfile.id}`,
      );
    } catch (error) {
      this.logger.error(
        `An error occurred in registerDeviceToken: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await this.supabase.auth.setSession({
        access_token: serviceRoleKey,
        refresh_token: '',
      });
      this.logger.log('Auth context has been reset to service_role.');
    }
  }

  private propertyMatchesCriteria(property: any, criteria: any): boolean {
    if (
      criteria.property_type &&
      property.property_type !== criteria.property_type
    ) {
      return false;
    }

    if (criteria.category && property.category !== criteria.category) {
      return false;
    }

    if (
      criteria.location &&
      !property.location.toLowerCase().includes(criteria.location.toLowerCase())
    ) {
      return false;
    }

    if (criteria.min_price && property.price < criteria.min_price) {
      return false;
    }
    if (criteria.max_price && property.price > criteria.max_price) {
      return false;
    }

    if (
      criteria.bedrooms &&
      property.effective_bedrooms !== criteria.bedrooms
    ) {
      return false;
    }

    if (
      criteria.bathrooms &&
      property.effective_bathrooms !== criteria.bathrooms
    ) {
      return false;
    }

    if (
      criteria.min_square_meters &&
      property.effective_square_meters < criteria.min_square_meters
    ) {
      return false;
    }
    if (
      criteria.max_square_meters &&
      property.effective_square_meters > criteria.max_square_meters
    ) {
      return false;
    }

    return true;
  }

  private async notifyUserAboutMatch(savedSearch: any, property: any) {
    try {
      await this.createNotificationForUser({
        user_id: savedSearch.user_id,
        type: 'property_match',
        title: 'New Property Match!',
        body: `A new ${property.category} in ${property.location} matches your "${savedSearch.name}" search`,
        data: {
          saved_search_id: savedSearch.id,
          property_id: property.id,
          property_title: property.title,
          property_price: property.price,
          property_location: property.location,
        },
      });

      await this.supabase.from('search_notifications').insert({
        saved_search_id: savedSearch.id,
        property_id: property.id,
        user_id: savedSearch.user_id,
      });

      this.logger.log(
        `Notified user ${savedSearch.user_id} about property match for search "${savedSearch.name}"`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify user about property match: ${error.message}`,
      );
    }
  }

  private async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    try {
      const { data: deviceTokens, error } = await this.supabase
        .from('device_tokens')
        .select('token')
        .eq('user_id', userId);

      if (error || !deviceTokens?.length) {
        this.logger.log(`No device tokens found for user ${userId}`);
        return;
      }

      const messages: ExpoPushMessage[] = deviceTokens
        .filter((dt) => Expo.isExpoPushToken(dt.token))
        .map((dt) => ({
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
          this.logger.log(
            `Sent push notification chunk: ${JSON.stringify(ticketChunk)}`,
          );
        } catch (error) {
          this.logger.error(`Error sending push notification chunk:`, error);
        }
      }
    } catch (error) {
      this.logger.error(`Error in sendPushNotification:`, error);
    }
  }
}