import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Building, Mail, Phone, MessageSquare, Calendar, Target, Cpu, Warehouse, Clock, MapPin, Globe, Monitor, Smartphone } from 'lucide-react';

interface LeadDetailModalProps {
  lead: any;
  isOpen: boolean;
  onClose: () => void;
}

export function LeadDetailModal({ lead, isOpen, onClose }: LeadDetailModalProps) {
  if (!lead) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="sticky top-0 bg-gradient-to-r from-primary to-primary-dark text-white p-6 rounded-t-2xl flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">{lead.full_name}</h2>
                  <p className="text-blue-100">{lead.organization}</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {/* Lead Score Badge */}
                <div className="flex justify-center">
                  <div className={`px-6 py-3 rounded-full text-center ${
                    lead.lead_score >= 80
                      ? 'bg-green-100 text-green-800'
                      : lead.lead_score >= 60
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    <div className="text-3xl font-bold">{lead.lead_score}</div>
                    <div className="text-sm">Lead Score</div>
                  </div>
                </div>

                {/* Contact Information */}
                <section>
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <User className="text-primary" />
                    Contact Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoCard icon={User} label="Full Name" value={lead.full_name} />
                    <InfoCard icon={Building} label="Organization" value={lead.organization} />
                    <InfoCard
                      icon={Mail}
                      label="Email"
                      value={lead.email}
                      link={`mailto:${lead.email}`}
                    />
                    <InfoCard
                      icon={Phone}
                      label="Phone"
                      value={lead.phone}
                      link={`tel:${lead.phone}`}
                    />
                    <InfoCard icon={MessageSquare} label="Preferred Contact" value={lead.contact_method} />
                    <InfoCard icon={Calendar} label="Submitted" value={new Date(lead.created_at).toLocaleString()} />
                  </div>
                </section>

                {/* Business Information */}
                <section>
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Target className="text-primary" />
                    Business Details
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoCard icon={Building} label="Industry" value={lead.industry} />
                    <InfoCard icon={Target} label="Primary Challenge" value={lead.challenge} />
                    <InfoCard icon={Cpu} label="Current Automation Level" value={lead.automation_level} />
                    <InfoCard icon={Warehouse} label="Facility Size" value={lead.facility_size} />
                    <InfoCard icon={Clock} label="Implementation Timeline" value={lead.timeline} />
                  </div>
                </section>

                {/* Solutions Interest */}
                <section>
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Cpu className="text-primary" />
                    Solutions of Interest
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {lead.solutions_interest?.map((solution: string, index: number) => (
                      <span
                        key={index}
                        className="px-4 py-2 bg-blue-100 text-blue-800 rounded-full text-sm font-medium"
                      >
                        {solution}
                      </span>
                    ))}
                  </div>
                </section>

                {/* Additional Notes */}
                {lead.notes && (
                  <section>
                    <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <MessageSquare className="text-primary" />
                      Additional Notes
                    </h3>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-gray-700">{lead.notes}</p>
                    </div>
                  </section>
                )}

                {/* Marketing Attribution */}
                <section>
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Globe className="text-primary" />
                    Marketing Attribution
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoCard
                      icon={Globe}
                      label="UTM Source"
                      value={lead.utm_source || 'Direct'}
                      badge={true}
                      badgeColor="blue"
                    />
                    <InfoCard
                      icon={Globe}
                      label="UTM Medium"
                      value={lead.utm_medium || 'None'}
                    />
                    <InfoCard
                      icon={Globe}
                      label="UTM Campaign"
                      value={lead.utm_campaign || 'None'}
                      badge={true}
                      badgeColor="purple"
                    />
                    <InfoCard
                      icon={Globe}
                      label="UTM Content"
                      value={lead.utm_content || 'None'}
                    />
                    <InfoCard
                      icon={User}
                      label="Sales Rep"
                      value={lead.sales_rep_name || 'None'}
                      badge={true}
                      badgeColor="green"
                    />
                    <InfoCard
                      icon={User}
                      label="Sales Rep ID"
                      value={lead.sales_rep_id || 'None'}
                    />
                  </div>
                </section>

                {/* Device & Technical Info */}
                <section>
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Monitor className="text-primary" />
                    Device & Browser Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <InfoCard icon={Smartphone} label="Device Type" value={lead.device_type || 'Unknown'} />
                    <InfoCard icon={Monitor} label="Browser" value={lead.browser || 'Unknown'} />
                    <InfoCard icon={Monitor} label="Operating System" value={lead.os || 'Unknown'} />
                    <InfoCard icon={Monitor} label="Screen Resolution" value={lead.screen_resolution || 'Unknown'} />
                    <InfoCard icon={Monitor} label="Viewport Size" value={lead.viewport_size || 'Unknown'} />
                    <InfoCard icon={MapPin} label="Timezone" value={lead.timezone || 'Unknown'} />
                    <InfoCard icon={Globe} label="Language" value={lead.language || 'Unknown'} />
                    <InfoCard icon={Globe} label="Referrer" value={lead.referrer || 'Direct'} truncate={true} />
                    <InfoCard icon={Globe} label="Landing Page" value={lead.landing_page || 'Unknown'} truncate={true} />
                  </div>
                </section>

                {/* Session Details */}
                <section>
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Clock className="text-primary" />
                    Session Details
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoCard icon={Clock} label="Session ID" value={lead.session_id} truncate={true} />
                    <InfoCard icon={Clock} label="Session Status" value={lead.status} />
                    <InfoCard
                      icon={Clock}
                      label="Time to Complete"
                      value={lead.session_duration_seconds ? `${Math.round(lead.session_duration_seconds)} seconds` : 'N/A'}
                    />
                    <InfoCard icon={Clock} label="Max Step Reached" value={lead.max_step_reached || 'N/A'} />
                    <InfoCard icon={Clock} label="Total Events" value={lead.total_events || '0'} />
                  </div>
                </section>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 bg-gray-50 p-6 rounded-b-2xl flex justify-end gap-4">
                <button
                  onClick={onClose}
                  className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  Close
                </button>
                <a
                  href={`mailto:${lead.email}?subject=Following up on your robotics inquiry`}
                  className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                >
                  Send Email
                </a>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

interface InfoCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  link?: string;
  badge?: boolean;
  badgeColor?: 'blue' | 'purple' | 'green';
  truncate?: boolean;
}

function InfoCard({ icon: Icon, label, value, link, badge, badgeColor = 'blue', truncate }: InfoCardProps) {
  const badgeColors = {
    blue: 'bg-blue-100 text-blue-800',
    purple: 'bg-purple-100 text-purple-800',
    green: 'bg-green-100 text-green-800',
  };

  const content = (
    <div className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-gray-500" />
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      {badge ? (
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${badgeColors[badgeColor]}`}>
          {value}
        </span>
      ) : (
        <p className={`font-medium text-gray-900 ${truncate ? 'truncate' : ''}`} title={value}>
          {value}
        </p>
      )}
    </div>
  );

  if (link) {
    return (
      <a href={link} className="block">
        {content}
      </a>
    );
  }

  return content;
}
