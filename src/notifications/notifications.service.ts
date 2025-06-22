// src/notifications/notifications.service.ts
import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_CLIENT } from '../supabase/supabase.constants';
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

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private expo = new Expo();

  constructor(
    @Inject(SUPABASE_ANON_CLIENT) private readonly supabase: SupabaseClient,
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
          `id, property_id, promotion_expires_at,
           properties!inner(id, title, user_id)`,
        )
        .eq('payment_status', 'successful')
        .lte('promotion_expires_at', oneDayFromNow.toISOString())
        .gte('promotion_expires_at', new Date().toISOString())
      ) as { data: PromotionWithProperty[] | null; error: any };

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
        if (
          !promotion.properties ||
          typeof promotion.properties !== 'object'
        ) {
          this.logger.error(
            `No properties data for promotion ${promotion.id}`,
          );
          continue;
        }
        const property = promotion.properties;
        if (!property.title || !property.user_id) {
          this.logger.error(
            `Invalid property data for promotion ${promotion.id}`,
          );
          continue;
        }

        // Delegate duplicate handling to createNotification
        try {
          await this.createNotification({
            user_id: property.user_id,
            type: 'promotion_expiring',
            title: 'Promotion Expiring Soon',
            body: `Your promotion for "${property.title}" expires soon`,
            data: {
              promotion_id: promotion.id,
              property_id: promotion.property_id,
              property_title: property.title,
              expires_at: promotion.promotion_expires_at,
            },
          });
          this.logger.log(
            `Notification created for promotion ${promotion.id}`,
          );
        } catch (err: any) {
          this.logger.error(
            `Failed to notify for promotion ${promotion.id}: ${err.message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error('Error in checkExpiringPromotions:', err);
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkNewPropertiesForSavedSearches() {
    this.logger.log(
      'Checking new properties against saved searches...',
    );
    try {
      // Look back exactly 10 minutes + 30s buffer
      const lookback = new Date();
      lookback.setMinutes(lookback.getMinutes() - 10);
      lookback.setSeconds(lookback.getSeconds() - 30);

      const { data: newProperties, error: propertiesError } =
        await this.supabase
          .from('properties_view')
          .select('*')
          .gte('created_at', lookback.toISOString())
          .eq('status', 'available');

      if (propertiesError) {
        this.logger.error(
          `Error fetching new properties: ${propertiesError.message}`,
        );
        return;
      }
      if (!newProperties?.length) {
        this.logger.log('No new properties found');
        return;
      }
      this.logger.log(`Found ${newProperties.length} new properties`);

      const { data: savedSearches, error: searchesError } =
        await this.supabase
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
      if (!savedSearches?.length) {
        this.logger.log('No active saved searches found');
        return;
      }

      const userIds = [
        ...new Set(savedSearches.map((s) => s.user_id)),
      ];
      const { data: userProfiles, error: profilesError } =
        await this.supabase
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

      const { data: userSubscriptions, error: subsError } =
        await this.supabase
          .from('user_subscriptions')
          .select('user_id, status, expires_at')
          .in('user_id', userIds)
          .eq('status', 'active')
          .gte('expires_at', new Date().toISOString());
      if (subsError) {
        this.logger.error(
          `Error fetching subscriptions: ${subsError.message}`,
        );
        return;
      }

      const profilesMap = new Map(
        userProfiles.map((p) => [p.id, p]),
      );
      const subsMap = new Map(
        userSubscriptions.map((s) => [s.user_id, s]),
      );

      const eligibleSearches = savedSearches.filter((search) => {
        const profile = profilesMap.get(search.user_id);
        const sub = subsMap.get(search.user_id);
        return (
          profile?.role === 'user' && sub?.status === 'active'
        );
      });

      if (!eligibleSearches.length) {
        this.logger.log(
          'No subscribed users with active saved searches',
        );
        return;
      }
      this.logger.log(
        `Found ${eligibleSearches.length} eligible searches`,
      );

      for (const property of newProperties) {
        for (const search of eligibleSearches) {
          if (
            this.propertyMatchesCriteria(
              property,
              search.criteria,
            )
          ) {
            await this.notifyUserAboutMatch(search, property);
          }
        }
      }
    } catch (err) {
      this.logger.error(
        'Error in checkNewPropertiesForSavedSearches:',
        err,
      );
    }
  }

  private async notifyUserAboutMatch(
    savedSearch: SavedSearch,
    property: any,
  ) {
    try {
      // Atomic insert; unique index on (saved_search_id, property_id)
      const { data, error } = await this.supabase
        .from('search_notifications')
        .insert({
          saved_search_id: savedSearch.id,
          property_id: property.id,
          user_id: savedSearch.user_id,
        })
        .single();

      if (error) {
        // Skip if already exists
        if (error.code === '23505') {
          this.logger.log(
            `Already notified: search=${savedSearch.id} property=${property.id}`,
          );
          return;
        }
        this.logger.error(
          `Error inserting search_notifications: ${error.message}`,
        );
        return;
      }

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

      this.logger.log(
        `Notified user ${savedSearch.user_id} about match for "${savedSearch.name}"`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to notify user about property match: ${err.message}`,
      );
    }
  }

  async createNotification(
    dto: CreateNotificationDto,
  ): Promise<Notification> {
    // Verify agent role
    const { data: profile, error: profileErr } = await this.supabase
      .from('profiles')
      .select('role')
      .eq('id', dto.user_id)
      .maybeSingle();
    if (profileErr) {
      this.logger.error(
        `Error fetching profile: ${profileErr.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to verify user',
      );
    }
    if (!profile || profile.role !== 'agent') {
      this.logger.warn(
        `Non-agent notification attempt: ${dto.user_id}`,
      );
      throw new InternalServerErrorException(
        'Agents only',
      );
    }

    try {
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
        if (error.code === '23505') {
          this.logger.log(
            `Duplicate notification skipped: type=${dto.type} user=${dto.user_id}`,
          );
          const { data: existing } = await this.supabase
            .from('notifications')
            .select('*')
            .eq('user_id', dto.user_id)
            .eq('type', dto.type)
            .eq(
              "(data->>'promotion_id')",
              dto.data?.promotion_id,
            )
            .maybeSingle();
          return existing!;
        }
        this.logger.error(
          `Error creating notification: ${error.message}`,
        );
        throw new InternalServerErrorException(
          'Failed to create notification',
        );
      }

      await this.sendPushNotification(
        dto.user_id,
        dto.title,
        dto.body,
        dto.data,
      );
      return data!;
    } catch (err) {
      this.logger.error(
        `createNotification error: ${err.message}`,
        err,
      );
      throw err;
    }
  }

  async createNotificationForUser(dto: {
    user_id: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<void> {
    const { data: profile, error: profErr } = await this.supabase
      .from('profiles')
      .select('role')
      .eq('id', dto.user_id)
      .maybeSingle();
    if (profErr || !profile || profile.role !== 'user') {
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
      this.logger.error(
        `Error creating user notification: ${error.message}`,
      );
      return;
    }
    await this.sendPushNotification(
      dto.user_id,
      dto.title,
      dto.body,
      dto.data,
    );
  }

  async getUserNotifications(
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<NotificationsResponse> {
    const { data: profile, error: profErr } = await this.supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (profErr) {
      this.logger.error(
        `Error fetching profile: ${profErr.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to verify user',
      );
    }
    if (!profile || !['user', 'agent'].includes(profile.role)) {
      throw new InternalServerErrorException(
        'Invalid role',
      );
    }

    const { page = 1, pageSize = 20, unreadOnly = false } = query;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let builder = this.supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (unreadOnly) {
      builder = builder.is('read_at', null);
    }

    const { data, error, count } = await builder;
    if (error) {
      this.logger.error(
        `Error fetching notifications: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to fetch notifications',
      );
    }

    const { count: unreadCount = 0 } = (await this.supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)) as any;

    return {
      notifications: data || [],
      total: count || 0,
      page,
      pageSize,
      unreadCount,
    };
  }

  async markAsRead(
    userId: string,
    notificationId: string,
  ): Promise<void> {
    const { data: profile, error: profErr } = await this.supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (
      profErr ||
      !profile ||
      !['user', 'agent'].includes(profile.role)
    ) {
      throw new InternalServerErrorException(
        'Unauthorized',
      );
    }
    const { error } = await this.supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', userId);
    if (error) {
      this.logger.error(
        `Error marking as read: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to mark as read',
      );
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    const { data: profile, error: profErr } = await this.supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (
      profErr ||
      !profile ||
      !['user', 'agent'].includes(profile.role)
    ) {
      throw new InternalServerErrorException(
        'Unauthorized',
      );
    }
    const { error } = await this.supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) {
      this.logger.error(
        `Error marking all as read: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to mark all as read',
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
        'Active subscription required',
      );
    }
    const canSaveMore =
      await this.subscriptionsService.canUserSaveMoreSearches(
        userId,
      );
    if (!canSaveMore) {
      const features =
        await this.subscriptionsService.getUserSubscriptionFeatures(
          userId,
        );
      throw new BadRequestException(
        `Saved search limit (${
          features?.max_saved_searches || 0
        }) reached`,
      );
    }
    const { data, error } = await this.supabase
      .from('saved_searches')
      .insert({
        user_id: userId,
        name: dto.name,
        criteria: dto.criteria,
        notification_enabled:
          dto.notification_enabled ?? true,
      })
      .select()
      .single();
    if (error) {
      this.logger.error(
        `Error creating saved search: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to create saved search',
      );
    }
    return data;
  }

  async getUserSavedSearches(userId: string) {
    const { data, error } = await this.supabase
      .from('saved_searches')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error(
        `Error fetching saved searches: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to fetch saved searches',
      );
    }
    return data || [];
  }

  async updateSavedSearch(
    userId: string,
    searchId: string,
    dto: UpdateSavedSearchDto,
  ) {
    const { data, error } = await this.supabase
      .from('saved_searches')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', searchId)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) {
      this.logger.error(
        `Error updating saved search: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to update saved search',
      );
    }
    if (!data) {
      throw new NotFoundException('Saved search not found');
    }
    return data;
  }

  async deleteSavedSearch(
    userId: string,
    searchId: string,
  ) {
    const { error } = await this.supabase
      .from('saved_searches')
      .delete()
      .eq('id', searchId)
      .eq('user_id', userId);
    if (error) {
      this.logger.error(
        `Error deleting saved search: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to delete saved search',
      );
    }
  }

async registerDeviceToken(
  userIdFromJwt: string,
  dto: RegisterDeviceTokenDto,
  jwt: string,
) {
  this.logger.log(`Registering device token for ${userIdFromJwt}`);
  const serviceRoleKey = this.configService.get<string>(
    'SUPABASE_SERVICE_ROLE_KEY',
  );
  if (!serviceRoleKey) {
    throw new InternalServerErrorException('Server config error');
  }

  try {
    // Temporarily set the user's JWT
    await this.supabase.auth.setSession({
      access_token: jwt,
      refresh_token: '',
    });

    // Fetch both id and role
    const { data: profile, error: profErr } = await this.supabase
      .from('profiles')
      .select('id, role')
      .eq('id', userIdFromJwt)
      .maybeSingle();

    if (profErr || !profile) {
      throw new InternalServerErrorException('Profile not found');
    }
    if (!['user', 'agent'].includes(profile.role)) {
      throw new InternalServerErrorException('Invalid role');
    }

    const { error: upsertErr } = await this.supabase
      .from('device_tokens')
      .upsert(
        {
          user_id: profile.id,
          token: dto.token,
          platform: dto.platform,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'token' },
      );

    if (upsertErr) {
      this.logger.error(
        `Error registering device token: ${upsertErr.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to register device token',
      );
    }

    this.logger.log('Device token registered');
  } finally {
    // Reset to service role key
    await this.supabase.auth.setSession({
      access_token: serviceRoleKey,
      refresh_token: '',
    });
  }
}

  private propertyMatchesCriteria(
    property: any,
    criteria: any,
  ): boolean {
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
      !property.location
        .toLowerCase()
        .includes(criteria.location.toLowerCase())
    ) {
      return false;
    }
    if (
      criteria.min_price != null &&
      property.price < criteria.min_price
    ) {
      return false;
    }
    if (
      criteria.max_price != null &&
      property.price > criteria.max_price
    ) {
      return false;
    }
    if (
      criteria.bedrooms != null &&
      property.effective_bedrooms !== criteria.bedrooms
    ) {
      return false;
    }
    if (
      criteria.bathrooms != null &&
      property.effective_bathrooms !== criteria.bathrooms
    ) {
      return false;
    }
    if (
      criteria.min_square_meters != null &&
      property.effective_square_meters <
        criteria.min_square_meters
    ) {
      return false;
    }
    if (
      criteria.max_square_meters != null &&
      property.effective_square_meters >
        criteria.max_square_meters
    ) {
      return false;
    }
    return true;
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
        this.logger.log(
          `No device tokens for user ${userId}`,
        );
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

      if (!messages.length) {
        this.logger.log(
          `No valid Expo tokens for user ${userId}`,
        );
        return;
      }

      const chunks = this.expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        try {
          const tickets =
            await this.expo.sendPushNotificationsAsync(
              chunk,
            );
          this.logger.log(
            `Push tickets: ${JSON.stringify(tickets)}`,
          );
        } catch (err) {
          this.logger.error(
            `Error sending push chunk: ${err}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`sendPushNotification error: ${err}`);
    }
  }
}