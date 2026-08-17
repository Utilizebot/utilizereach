import { motion } from 'framer-motion';
import {
  CircleDashed,
  Gauge,
  Activity,
  Zap,
  Maximize2,
  Home,
  Building,
  Building2,
} from 'lucide-react';
import { OptionCard } from './OptionCard';
import { useTracking } from '../../hooks/useTracking';

interface Step2Props {
  automation_level: string;
  facility_size: string;
  onAutomationLevelChange: (level: string) => void;
  onFacilitySizeChange: (size: string) => void;
}

const automationLevels = [
  {
    id: 'none',
    value: 'No automation - fully manual operations',
    icon: CircleDashed,
    description: 'Looking to start automation journey',
  },
  {
    id: 'some',
    value: 'Some automation - looking to expand',
    icon: Gauge,
    description: 'Have basic automation, want more',
  },
  {
    id: 'moderate',
    value: 'Moderate automation - need optimization',
    icon: Activity,
    description: 'Optimize existing automation',
  },
  {
    id: 'high',
    value: 'Highly automated - seeking advanced solutions',
    icon: Zap,
    description: 'Advanced automation needs',
  },
];

const facilitySizes = [
  {
    id: 'small',
    value: 'Small (< 5,000 sq ft)',
    icon: Home,
  },
  {
    id: 'medium',
    value: 'Medium (5,000 - 20,000 sq ft)',
    icon: Building,
  },
  {
    id: 'large',
    value: 'Large (20,000 - 50,000 sq ft)',
    icon: Building2,
  },
  {
    id: 'very-large',
    value: 'Very Large (50,000+ sq ft)',
    icon: Maximize2,
  },
];

export function Step2({
  automation_level,
  facility_size,
  onAutomationLevelChange,
  onFacilitySizeChange,
}: Step2Props) {
  const { trackSelection } = useTracking(2);

  const handleAutomationSelect = (value: string) => {
    onAutomationLevelChange(value);
    trackSelection('automation_level', value);
  };

  const handleFacilitySelect = (value: string) => {
    onFacilitySizeChange(value);
    trackSelection('facility_size', value);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      {/* Automation Level */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          What best describes your current automation level?
        </h2>
        <p className="text-gray-600 mb-6">
          Understanding your current setup helps us recommend the right solutions
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {automationLevels.map((item) => (
            <OptionCard
              key={item.id}
              icon={item.icon}
              title={item.value}
              description={item.description}
              selected={automation_level === item.value}
              onClick={() => handleAutomationSelect(item.value)}
            />
          ))}
        </div>
      </div>

      {/* Facility Size */}
      {automation_level && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            What's your approximate facility size?
          </h2>
          <p className="text-gray-600 mb-6">
            Facility size helps us determine the scale of automation needed
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {facilitySizes.map((item) => (
              <OptionCard
                key={item.id}
                icon={item.icon}
                title={item.value}
                selected={facility_size === item.value}
                onClick={() => handleFacilitySelect(item.value)}
              />
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
