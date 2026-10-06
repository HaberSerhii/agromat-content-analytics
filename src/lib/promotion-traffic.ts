// Keep funnel and product metrics on the same session attribution.
export const PROMOTION_CHANNELS = ["all", "organic", "cpc", "meta_cpc", "direct"] as const;

export const promotionTrafficFieldsSql = `
    LOWER(COALESCE(
      session_traffic_source_last_click.cross_channel_campaign.source,
      IF(session_traffic_source_last_click.google_ads_campaign.campaign_id IS NOT NULL, 'google', NULL),
      session_traffic_source_last_click.manual_campaign.source, ''
    )) AS traffic_source_name,
    LOWER(COALESCE(
      session_traffic_source_last_click.cross_channel_campaign.medium,
      IF(session_traffic_source_last_click.google_ads_campaign.campaign_id IS NOT NULL, 'cpc', NULL),
      session_traffic_source_last_click.manual_campaign.medium, ''
    )) AS traffic_medium,
    LOWER(COALESCE(
      session_traffic_source_last_click.cross_channel_campaign.campaign_name,
      session_traffic_source_last_click.google_ads_campaign.campaign_name,
      session_traffic_source_last_click.manual_campaign.campaign_name, ''
    )) AS traffic_campaign_name`;

export const promotionChannelSql = `CASE
      WHEN traffic_source_name = 'google' AND traffic_medium = 'cpc' THEN 'cpc'
      WHEN traffic_source_name = 'meta' AND traffic_medium = 'cpc' THEN 'meta_cpc'
      WHEN traffic_medium = 'organic' THEN 'organic'
      WHEN traffic_source_name = '(direct)' AND traffic_medium = '(none)' THEN 'direct'
      ELSE 'other'
    END`;
