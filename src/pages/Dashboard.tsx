import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  CheckCircle,
  TrendingUp,
  Clock,
  Activity,
  BarChart3,
  PieChart,
  UserCheck,
  Eye,
  Target,
  Smartphone,
  Monitor,
  Globe,
  Zap,
  Star,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useAnalytics } from '../hooks/useAnalytics';
import { LeadDetailModal } from '../components/LeadDetailModal';
import { useConfig } from '../context/ConfigContext';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart as RePieChart,
  Pie,
  Cell,
} from 'recharts';

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#06b6d4'];

export function Dashboard() {
  const config = useConfig();
  const { data, loading, error, refetch } = useAnalytics();
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch?.();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleViewLead = (lead: any) => {
    setSelectedLead(lead);
    setIsModalOpen(true);
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <motion.div
            className="inline-block h-16 w-16 border-4 border-blue-600 border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="mt-4 text-gray-600 font-medium">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Failed to Load</h2>
          <p className="text-gray-600 mb-6">{error?.message || 'Error loading analytics'}</p>
          <button
            onClick={handleRefresh}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-medium hover:shadow-lg transition-all"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
            <BarChart3 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
              {config.dashboard.title}
            </h1>
            <p className="text-gray-600 text-sm mt-0.5">
              {config.dashboard.subtitle}
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="font-medium text-sm">Refresh</span>
        </button>
      </motion.div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          icon={Globe}
          title="Website Clicks"
          value={data.totalWebsiteClicks}
          subtitle="Clicked to website"
          gradient="from-teal-500 to-cyan-600"
          delay={0}
        />
        <MetricCard
          icon={Users}
          title="Total Form Starts"
          value={data.totalStarts}
          subtitle="Forms initiated"
          gradient="from-blue-500 to-indigo-600"
          delay={0.05}
        />
        <MetricCard
          icon={CheckCircle}
          title="Total Completions"
          value={data.totalCompletions}
          subtitle="Forms submitted"
          gradient="from-emerald-500 to-green-600"
          delay={0.1}
        />
        <MetricCard
          icon={TrendingUp}
          title="Completion Rate"
          value={`${data.completionRate.toFixed(1)}%`}
          subtitle={data.completionRate >= 50 ? 'Excellent' : 'Good'}
          gradient="from-purple-500 to-violet-600"
          delay={0.15}
        />
        <MetricCard
          icon={Clock}
          title="Avg. Time"
          value={`${Math.round(data.averageTimeToComplete)}s`}
          subtitle="To complete form"
          gradient="from-orange-500 to-amber-600"
          delay={0.2}
        />
      </div>

      {/* SECTION 1: LEAD ANALYTICS */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
            <Users className="h-5 w-5 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Lead Analytics</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Lead Score Distribution */}
            <ChartCard title="Lead Score Distribution" icon={Star} delay={0.4}>
              {(() => {
                const scoreRanges = [
                  { range: '80-100', min: 80, max: 100 },
                  { range: '60-79', min: 60, max: 79 },
                  { range: '40-59', min: 40, max: 59 },
                  { range: '0-39', min: 0, max: 39 },
                ];
                const scoreData = scoreRanges.map(({ range, min, max }) => ({
                  range,
                  count: data.recentLeads.filter(
                    (lead: any) => lead.lead_score >= min && lead.lead_score <= max
                  ).length,
                }));
                return (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={scoreData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="range" angle={-20} textAnchor="end" height={60} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#F59E0B" />
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </ChartCard>

            {/* Industry Distribution */}
            <ChartCard title="Industry Breakdown" icon={Globe} delay={0.45}>
              {(() => {
                const industryMap = new Map<string, number>();
                data.recentLeads.forEach((lead: any) => {
                  const industry = lead.industry || 'Unknown';
                  industryMap.set(industry, (industryMap.get(industry) || 0) + 1);
                });
                const industryData = Array.from(industryMap.entries()).map(([name, value]) => ({
                  name,
                  value,
                }));
                return (
                  <ResponsiveContainer width="100%" height={220}>
                    <RePieChart>
                      <Pie
                        data={industryData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={(entry) => `${entry.value}`}
                        style={{ fontSize: '11px' }}
                      >
                        {industryData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend
                        wrapperStyle={{ fontSize: '10px' }}
                        iconSize={8}
                      />
                    </RePieChart>
                  </ResponsiveContainer>
                );
              })()}
            </ChartCard>

            {/* Timeline Distribution */}
            <ChartCard title="Implementation Timeline" icon={Clock} delay={0.5}>
              {(() => {
                const timelineMap = new Map<string, number>();
                data.recentLeads.forEach((lead: any) => {
                  const timeline = lead.timeline || 'Unknown';
                  timelineMap.set(timeline, (timelineMap.get(timeline) || 0) + 1);
                });
                const timelineData = Array.from(timelineMap.entries()).map(([name, value]) => ({
                  name,
                  value,
                  shortName: name.length > 15 ? name.substring(0, 15) + '...' : name,
                }));
                return (
                  <div className="flex items-center gap-2">
                    <ResponsiveContainer width="55%" height={180}>
                      <RePieChart>
                        <Pie
                          data={timelineData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={60}
                          label={(entry) => `${entry.value}`}
                          labelLine={false}
                        >
                          {timelineData.map((_entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </RePieChart>
                    </ResponsiveContainer>
                    <div className="w-[45%] text-xs space-y-1 overflow-y-auto max-h-[180px]">
                      {timelineData.map((item, index) => (
                        <div key={index} className="flex items-center gap-1.5">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          />
                          <span className="text-gray-600 truncate" title={item.name}>
                            {item.shortName} ({item.value})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </ChartCard>

            {/* Popular Solutions */}
            <ChartCard title="Top Solutions" icon={Zap} delay={0.55}>
              {(() => {
                const solutionsMap = new Map<string, number>();
                data.recentLeads.forEach((lead: any) => {
                  if (Array.isArray(lead.solutions_interest)) {
                    lead.solutions_interest.forEach((solution: string) => {
                      solutionsMap.set(solution, (solutionsMap.get(solution) || 0) + 1);
                    });
                  }
                });
                const solutionsData = Array.from(solutionsMap.entries())
                  .map(([name, value]) => ({
                    name,
                    value,
                    shortName: name.length > 15 ? name.substring(0, 15) + '...' : name,
                  }))
                  .sort((a, b) => b.value - a.value)
                  .slice(0, 5);
                return (
                  <div className="flex items-center gap-2">
                    <ResponsiveContainer width="55%" height={180}>
                      <RePieChart>
                        <Pie
                          data={solutionsData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={60}
                          label={(entry) => `${entry.value}`}
                          labelLine={false}
                        >
                          {solutionsData.map((_entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </RePieChart>
                    </ResponsiveContainer>
                    <div className="w-[45%] text-xs space-y-1 overflow-y-auto max-h-[180px]">
                      {solutionsData.map((item, index) => (
                        <div key={index} className="flex items-center gap-1.5">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          />
                          <span className="text-gray-600 truncate" title={item.name}>
                            {item.shortName} ({item.value})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </ChartCard>
        </div>
      </div>

      {/* SECTION 2: MARKETING PERFORMANCE */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex items-center justify-center">
            <Target className="h-5 w-5 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Marketing Performance</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Traffic Sources */}
            <ChartCard title="Traffic Sources" icon={PieChart} delay={0.6}>
              <ResponsiveContainer width="100%" height={220}>
                <RePieChart>
                  <Pie
                    data={data.sourceBreakdown}
                    dataKey="count"
                    nameKey="source"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={(entry) => `${entry.source}: ${entry.count}`}
                  >
                    {data.sourceBreakdown.map((_entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </RePieChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Campaign Performance */}
            <ChartCard title="Campaign Performance" icon={Target} delay={0.65}>
              {(() => {
                const campaignMap = new Map<string, number>();
                data.recentLeads.forEach((lead: any) => {
                  const campaign = lead.utm_campaign || 'None';
                  campaignMap.set(campaign, (campaignMap.get(campaign) || 0) + 1);
                });
                const campaignData = Array.from(campaignMap.entries()).map(
                  ([campaign, count]) => ({
                    campaign,
                    count,
                  })
                );
                return (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={campaignData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="campaign" angle={-20} textAnchor="end" height={60} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#8B5CF6" />
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </ChartCard>

            {/* Device Distribution */}
            <ChartCard title="Device Distribution" icon={Smartphone} delay={0.7}>
              {(() => {
                const deviceMap = new Map<string, number>();
                data.recentLeads.forEach((lead: any) => {
                  const device = lead.device_type || 'Unknown';
                  deviceMap.set(device, (deviceMap.get(device) || 0) + 1);
                });
                const deviceData = Array.from(deviceMap.entries()).map(([name, value]) => ({
                  name,
                  value,
                }));
                return (
                  <ResponsiveContainer width="100%" height={220}>
                    <RePieChart>
                      <Pie
                        data={deviceData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={(entry) => `${entry.name}: ${entry.value}`}
                      >
                        {deviceData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </RePieChart>
                  </ResponsiveContainer>
                );
              })()}
            </ChartCard>

            {/* Browser Distribution */}
            <ChartCard title="Browser Distribution" icon={Monitor} delay={0.75}>
              {(() => {
                const browserMap = new Map<string, number>();
                data.recentLeads.forEach((lead: any) => {
                  const browser = lead.browser || 'Unknown';
                  browserMap.set(browser, (browserMap.get(browser) || 0) + 1);
                });
                const browserData = Array.from(browserMap.entries())
                  .map(([name, value]) => ({ name, value }))
                  .sort((a, b) => b.value - a.value);
                return (
                  <ResponsiveContainer width="100%" height={220}>
                    <RePieChart>
                      <Pie
                        data={browserData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={(entry) => `${entry.value}`}
                      >
                        {browserData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </RePieChart>
                  </ResponsiveContainer>
                );
              })()}
            </ChartCard>
        </div>
      </div>

      {/* SECTION 3: CONVERSION & SALES PERFORMANCE */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 bg-gradient-to-br from-emerald-600 to-green-600 rounded-xl flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Conversion & Sales Performance</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Conversion Funnel */}
          <ChartCard title="Conversion Funnel" icon={BarChart3} delay={0.8}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.funnelData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="step" angle={-20} textAnchor="end" height={80} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0066CC" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

          {/* Sales Rep Performance Table */}
          {data.salesRepPerformance.length > 0 && (
            <motion.div
              className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.85 }}
            >
              <div className="flex items-center gap-2 mb-3">
                <UserCheck className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">Sales Team</h2>
              </div>
              <div className="overflow-auto max-h-[220px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b bg-gray-50">
                        <th className="text-left p-2 font-semibold">Rep</th>
                        <th className="text-right p-2 font-semibold">Leads</th>
                        <th className="text-right p-2 font-semibold">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.salesRepPerformance
                        .sort((a, b) => b.completions - a.completions)
                        .map((rep, index) => (
                          <tr key={index} className="border-b hover:bg-gray-50">
                            <td className="p-2 font-medium">{rep.name}</td>
                            <td className="p-2 text-right">
                              <span className="font-bold text-green-600">{rep.completions}</span>
                            </td>
                            <td className="p-2 text-right">
                              <span
                                className={`font-semibold ${
                                  rep.conversionRate >= 50
                                    ? 'text-green-600'
                                    : rep.conversionRate >= 30
                                    ? 'text-yellow-600'
                                    : 'text-gray-600'
                                }`}
                              >
                                {rep.conversionRate.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {/* Lead Distribution by Rep */}
            {data.salesRepPerformance.length > 0 && (
              <ChartCard title="Lead Distribution by Rep" icon={Target} delay={0.9}>
                <ResponsiveContainer width="100%" height={220}>
                  <RePieChart>
                    <Pie
                      data={data.salesRepPerformance.map((rep) => ({
                        name: rep.name,
                        value: rep.completions,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      label={(entry) => `${entry.value}`}
                    >
                      {data.salesRepPerformance.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </RePieChart>
                </ResponsiveContainer>
                <div className="mt-3 p-2 bg-blue-50 rounded text-xs">
                  <p className="text-gray-700">
                    <strong>Top:</strong> {data.salesRepPerformance[0]?.name || 'N/A'} (
                    {data.salesRepPerformance[0]?.completions || 0} leads)
                  </p>
                </div>
            </ChartCard>
          )}
        </div>
      </div>

      {/* Recent Leads Table */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.95 }}
      >
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Recent Leads</h2>
              <p className="text-sm text-gray-600">Detailed view with all lead information</p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase text-gray-600 whitespace-nowrap">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase text-gray-600 whitespace-nowrap">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase text-gray-600 whitespace-nowrap">Organization</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase text-gray-600 whitespace-nowrap">Industry</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase text-gray-600 whitespace-nowrap">Timeline</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase text-gray-600 whitespace-nowrap">Source</th>
                <th className="text-right px-4 py-3 font-semibold text-xs uppercase text-gray-600 whitespace-nowrap">Score</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase text-gray-600 whitespace-nowrap">Date</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase text-gray-600 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recentLeads.map((lead: any, index) => (
                <tr
                  key={index}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleViewLead(lead)}
                >
                  <td className="px-4 py-3 font-medium whitespace-nowrap text-gray-900">{lead.full_name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline">
                      {lead.email}
                    </a>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">{lead.organization}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{lead.industry}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{lead.timeline}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                      {lead.utm_source || 'Direct'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                        lead.lead_score >= 80
                          ? 'bg-emerald-100 text-emerald-700'
                          : lead.lead_score >= 60
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {lead.lead_score}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                    {new Date(lead.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewLead(lead);
                      }}
                      className="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:shadow-md transition-all flex items-center gap-1.5 mx-auto text-xs font-medium"
                    >
                      <Eye size={14} />
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <p className="text-sm text-gray-500">
            Showing {data.recentLeads.length} most recent leads
          </p>
        </div>
      </motion.div>

      {/* Lead Detail Modal */}
      <LeadDetailModal
        lead={selectedLead}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

interface MetricCardProps {
  icon: React.ElementType;
  title: string;
  value: string | number;
  subtitle?: string;
  gradient: string;
  delay: number;
}

function MetricCard({ icon: Icon, title, value, subtitle, gradient, delay }: MetricCardProps) {
  return (
    <motion.div
      className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5 relative overflow-hidden group hover:shadow-xl transition-shadow"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -4 }}
    >
      {/* Decorative gradient background */}
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${gradient} opacity-5 rounded-full blur-2xl group-hover:opacity-10 transition-opacity`} />

      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {subtitle && (
            <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`h-12 w-12 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center shadow-lg`}>
          <Icon size={24} className="text-white" />
        </div>
      </div>
    </motion.div>
  );
}

interface ChartCardProps {
  title: string;
  icon: React.ElementType;
  delay: number;
  children: React.ReactNode;
}

function ChartCard({ title, icon: Icon, delay, children }: ChartCardProps) {
  return (
    <motion.div
      className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5 hover:shadow-xl transition-shadow"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
          <Icon className="text-white" size={16} />
        </div>
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
      </div>
      {children}
    </motion.div>
  );
}
