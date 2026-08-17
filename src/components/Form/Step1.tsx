import { motion } from 'framer-motion';
import {
  Factory,
  Truck,
  Warehouse,
  HeartPulse,
  GraduationCap,
  MoreHorizontal,
  AlertCircle,
  Clock,
  DollarSign,
  Shield,
  TrendingUp,
  Package,
} from 'lucide-react';
import { OptionCard } from './OptionCard';
import { useTracking } from '../../hooks/useTracking';

interface Step1Props {
  industry: string;
  challenge: string;
  onIndustryChange: (industry: string) => void;
  onChallengeChange: (challenge: string) => void;
}

const industries = [
  {
    id: 'manufacturing',
    value: 'Manufacturing & Production',
    icon: Factory,
    description: 'Assembly lines, production facilities',
  },
  {
    id: 'logistics',
    value: 'Logistics & Distribution',
    icon: Truck,
    description: 'Transportation, delivery, fulfillment',
  },
  {
    id: 'warehousing',
    value: 'Warehousing & Storage',
    icon: Warehouse,
    description: 'Storage facilities, inventory management',
  },
  {
    id: 'healthcare',
    value: 'Healthcare & Pharmaceuticals',
    icon: HeartPulse,
    description: 'Medical facilities, pharmaceutical production',
  },
  {
    id: 'education',
    value: 'Education & Research',
    icon: GraduationCap,
    description: 'Universities, research institutions',
  },
  {
    id: 'other',
    value: 'Other',
    icon: MoreHorizontal,
    description: 'Tell us about your industry',
  },
];

const challenges = [
  {
    id: 'repetitive',
    value: 'Repetitive manual tasks slowing production',
    icon: AlertCircle,
  },
  {
    id: 'transport',
    value: 'Material transport taking too much time',
    icon: Clock,
  },
  {
    id: 'labor',
    value: 'Labor costs increasing',
    icon: DollarSign,
  },
  {
    id: 'safety',
    value: 'Workplace safety concerns',
    icon: Shield,
  },
  {
    id: 'scaling',
    value: 'Scaling operations is difficult',
    icon: TrendingUp,
  },
  {
    id: 'inventory',
    value: 'Inventory management inefficiencies',
    icon: Package,
  },
];

export function Step1({
  industry,
  challenge,
  onIndustryChange,
  onChallengeChange,
}: Step1Props) {
  const { trackSelection } = useTracking(1);

  const handleIndustrySelect = (value: string) => {
    onIndustryChange(value);
    trackSelection('industry', value);
  };

  const handleChallengeSelect = (value: string) => {
    onChallengeChange(value);
    trackSelection('challenge', value);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      {/* Industry Selection */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          What industry does your organization operate in?
        </h2>
        <p className="text-gray-600 mb-6">
          This helps us understand your specific automation needs
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {industries.map((item) => (
            <OptionCard
              key={item.id}
              icon={item.icon}
              title={item.value}
              description={item.description}
              selected={industry === item.value}
              onClick={() => handleIndustrySelect(item.value)}
            />
          ))}
        </div>
      </div>

      {/* Challenge Selection */}
      {industry && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            What's your biggest operational challenge?
          </h2>
          <p className="text-gray-600 mb-6">
            Select the challenge that impacts your operations the most
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {challenges.map((item) => (
              <OptionCard
                key={item.id}
                icon={item.icon}
                title={item.value}
                selected={challenge === item.value}
                onClick={() => handleChallengeSelect(item.value)}
              />
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
