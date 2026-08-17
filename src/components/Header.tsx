import { motion } from 'framer-motion';
import { getCurrentSessionId } from '../lib/tracking';
import { useConfig } from '../context/ConfigContext';

export function Header() {
  const config = useConfig();

  const handleWebsiteClick = async () => {
    try {
      const sessionId = getCurrentSessionId() || 'no-session';

      // Track the website click (fire-and-forget)
      await fetch('/api/tracking/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          event_type: 'website_click',
          event_data: {
            clicked_from: 'form_header',
            destination: config.company.website,
            timestamp: new Date().toISOString(),
          },
          step_number: null,
          time_since_start: 0,
        }),
        keepalive: true,
      });
    } catch (error) {
      console.error('Error tracking website click:', error);
    }
  };

  return (
    <motion.header
      className="bg-white shadow-md sticky top-0 z-50"
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Logo and Company Name */}
          <div className="flex items-center gap-3">
            <img
              src={config.company.logo}
              alt={`${config.company.name} Logo`}
              className="h-12 w-auto object-contain"
            />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {config.company.name}
              </h1>
              <p className="text-sm text-gray-600">
                {config.company.tagline}
              </p>
            </div>
          </div>

          {/* Contact Info */}
          <div className="hidden md:flex items-center gap-6 text-sm">
            <a
              href={config.company.website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleWebsiteClick}
              className="text-gray-600 hover:text-primary transition-colors"
            >
              Visit Website
            </a>
            <a
              href={`mailto:${config.company.email}`}
              className="text-gray-600 hover:text-primary transition-colors"
            >
              {config.company.email}
            </a>
            <a
              href={`tel:${config.company.phone}`}
              className="text-gray-600 hover:text-primary transition-colors"
            >
              {config.company.phone}
            </a>
          </div>
        </div>
      </div>
    </motion.header>
  );
}
