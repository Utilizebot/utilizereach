import { useState, useEffect } from 'react';
import { authHeaders } from '../lib/auth';

export interface AnalyticsData {
  totalPageVisits: number;
  totalWebsiteClicks: number;
  totalStarts: number;
  totalCompletions: number;
  completionRate: number;
  visitToStartRate: number;
  websiteClickRate: number;
  averageTimeToComplete: number;
  todayActivity: number;
  sourceBreakdown: { source: string; count: number }[];
  salesRepPerformance: {
    name: string;
    starts: number;
    completions: number;
    conversionRate: number;
  }[];
  funnelData: {
    step: string;
    count: number;
    dropoffRate: number;
  }[];
  recentLeads: any[];
  abandonmentData: {
    step: number;
    count: number;
  }[];
}

export function useAnalytics(dateRange?: { from: Date; to: Date }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetchAnalytics();

    // Poll silently — don't flash the loading spinner on background refreshes
    const interval = setInterval(() => {
      fetchAnalytics(true);
    }, 30000);

    return () => {
      clearInterval(interval);
    };
  }, [dateRange]);

  const fetchAnalytics = async (silent = false) => {
    try {
      if (!silent) setLoading(true);

      // Build date filter query (for future use)
      // const dateFilter = dateRange
      //   ? `created_at.gte.${dateRange.from.toISOString()},created_at.lte.${dateRange.to.toISOString()}`
      //   : '';

      // Single backend call returns all five datasets
      const response = await fetch('/api/analytics/overview', {
        headers: { ...authHeaders() },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(body.detail || `Failed to fetch analytics: ${response.status}`);
      }

      const overview = await response.json();
      const sessions: any[] = overview.sessions || [];
      const responses: any[] = overview.responses || [];
      const steps: any[] = overview.steps || [];
      const pageVisits: any[] = overview.pageVisits || [];
      const websiteClicks: any[] = overview.websiteClicks || [];

      // Calculate metrics
      const totalPageVisits = pageVisits?.length || 0;
      const totalWebsiteClicks = websiteClicks?.length || 0;
      const totalStarts = sessions?.length || 0;
      const totalCompletions = responses?.length || 0;
      const completionRate = totalStarts > 0 ? (totalCompletions / totalStarts) * 100 : 0;
      const visitToStartRate = totalPageVisits > 0 ? (totalStarts / totalPageVisits) * 100 : 0;
      const websiteClickRate = totalPageVisits > 0 ? (totalWebsiteClicks / totalPageVisits) * 100 : 0;

      // Average time to complete (in seconds)
      const completedSessions = sessions?.filter((s: any) => s.status === 'completed') || [];
      const avgTime =
        completedSessions.reduce((acc: number, session: any) => {
          if (session.completed_at) {
            const start = new Date(session.created_at).getTime();
            const end = new Date(session.completed_at).getTime();
            return acc + (end - start) / 1000;
          }
          return acc;
        }, 0) / (completedSessions.length || 1);

      // Today's activity
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayActivity = sessions?.filter(
        (s: any) => new Date(s.created_at) >= today
      ).length || 0;

      // Source breakdown
      const sourceMap = new Map<string, number>();
      sessions?.forEach((s: any) => {
        const source = s.utm_source || 'Direct';
        sourceMap.set(source, (sourceMap.get(source) || 0) + 1);
      });
      const sourceBreakdown = Array.from(sourceMap.entries()).map(([source, count]) => ({
        source,
        count,
      }));

      // Sales rep performance
      const repMap = new Map<string, { starts: number; completions: number }>();
      sessions?.forEach((s: any) => {
        if (s.sales_rep_name) {
          const current = repMap.get(s.sales_rep_name) || { starts: 0, completions: 0 };
          current.starts += 1;
          if (s.status === 'completed') {
            current.completions += 1;
          }
          repMap.set(s.sales_rep_name, current);
        }
      });
      const salesRepPerformance = Array.from(repMap.entries()).map(([name, stats]) => ({
        name,
        starts: stats.starts,
        completions: stats.completions,
        conversionRate: (stats.completions / stats.starts) * 100,
      }));

      // Funnel data - FIXED to show Step 1 properly
      const stepCounts = new Map<number, number>();
      steps?.forEach((step: any) => {
        stepCounts.set(step.step_number, (stepCounts.get(step.step_number) || 0) + 1);
      });

      // Use total sessions as Step 1 count (everyone who started)
      // Then use step tracking for subsequent steps
      const funnelData = [
        { step: 'Step 1: Industry', count: totalStarts, dropoffRate: 0 },
        { step: 'Step 2: Operations', count: stepCounts.get(2) || 0, dropoffRate: 0 },
        { step: 'Step 3: Solutions', count: stepCounts.get(3) || 0, dropoffRate: 0 },
        { step: 'Step 4: Contact', count: totalCompletions, dropoffRate: 0 },
      ];

      // Calculate dropoff rates
      funnelData.forEach((item, index) => {
        if (index > 0) {
          const prev = funnelData[index - 1].count;
          item.dropoffRate = prev > 0 ? ((prev - item.count) / prev) * 100 : 0;
        }
      });

      // Abandonment data
      const abandonmentMap = new Map<number, number>();
      steps?.forEach((step: any) => {
        if (!step.exited_at) {
          // Step was entered but not exited (abandoned)
          abandonmentMap.set(
            step.step_number,
            (abandonmentMap.get(step.step_number) || 0) + 1
          );
        }
      });
      const abandonmentData = Array.from(abandonmentMap.entries()).map(
        ([step, count]) => ({ step, count })
      );

      setError(null);
      setData({
        totalPageVisits,
        totalWebsiteClicks,
        totalStarts,
        totalCompletions,
        completionRate,
        visitToStartRate,
        websiteClickRate,
        averageTimeToComplete: avgTime,
        todayActivity,
        sourceBreakdown,
        salesRepPerformance,
        funnelData,
        recentLeads: responses?.slice(0, 10) || [],
        abandonmentData,
      });
    } catch (err) {
      setError(err as Error);
      console.error('Error fetching analytics:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  return { data, loading, error, refetch: () => fetchAnalytics(false) };
}
