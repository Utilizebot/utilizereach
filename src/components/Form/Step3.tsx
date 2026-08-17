import { motion } from 'framer-motion';
import {
  Navigation,
  Bot,
  Wrench,
  Settings,
  HelpCircle,
  Calendar,
  Clock3,
  Clock9,
  Clock,
  Lightbulb,
} from 'lucide-react';
import { OptionCard } from './OptionCard';
import { useTracking } from '../../hooks/useTracking';

interface Step3Props {
  solutions_interest: string[];
  timeline: string;
  onSolutionsChange: (solutions: string[]) => void;
  onTimelineChange: (timeline: string) => void;
}

const solutions = [
  {
    id: 'agv',
    value: 'AGV (Automated Guided Vehicles)',
    icon: Navigation,
    description: 'Predefined path material transport',
  },
  {
    id: 'amr',
    value: 'AMR (Autonomous Mobile Robots)',
    icon: Bot,
    description: 'Intelligent navigation robots',
  },
  {
    id: 'custom',
    value: 'Custom automation solutions',
    icon: Wrench,
    description: 'Bespoke robotics for your needs',
  },
  {
    id: 'integration',
    value: 'System integration & consulting',
    icon: Settings,
    description: 'Expert integration services',
  },
  {
    id: 'unsure',
    value: 'Not sure - need consultation',
    icon: HelpCircle,
    description: "Let's discuss your needs",
  },
];

const timelines = [
  {
    id: 'immediate',
    value: 'Immediate (0-3 months)',
    icon: Clock,
    description: 'Ready to start soon',
  },
  {
    id: 'short',
    value: 'Short-term (3-6 months)',
    icon: Clock3,
    description: 'Planning for near future',
  },
  {
    id: 'mid',
    value: 'Mid-term (6-12 months)',
    icon: Clock9,
    description: 'Next year planning',
  },
  {
    id: 'long',
    value: 'Long-term (12+ months)',
    icon: Calendar,
    description: 'Long-term strategy',
  },
  {
    id: 'exploring',
    value: 'Just exploring options',
    icon: Lightbulb,
    description: 'Learning about possibilities',
  },
];

export function Step3({
  solutions_interest,
  timeline,
  onSolutionsChange,
  onTimelineChange,
}: Step3Props) {
  const { trackSelection } = useTracking(3);

  const handleSolutionToggle = (value: string) => {
    let newSolutions: string[];

    if (solutions_interest.includes(value)) {
      newSolutions = solutions_interest.filter((s) => s !== value);
    } else {
      newSolutions = [...solutions_interest, value];
    }

    onSolutionsChange(newSolutions);
    trackSelection('solutions_interest', value);
  };

  const handleTimelineSelect = (value: string) => {
    onTimelineChange(value);
    trackSelection('timeline', value);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      {/* Solutions Interest */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Which robotics solutions interest you?
        </h2>
        <p className="text-gray-600 mb-6">
          Select all that apply - you can choose multiple options
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {solutions.map((item) => (
            <OptionCard
              key={item.id}
              icon={item.icon}
              title={item.value}
              description={item.description}
              selected={solutions_interest.includes(item.value)}
              onClick={() => handleSolutionToggle(item.value)}
            />
          ))}
        </div>
      </div>

      {/* Timeline */}
      {solutions_interest.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            What's your timeline for implementation?
          </h2>
          <p className="text-gray-600 mb-6">
            This helps us prioritize and plan accordingly
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {timelines.map((item) => (
              <OptionCard
                key={item.id}
                icon={item.icon}
                title={item.value}
                description={item.description}
                selected={timeline === item.value}
                onClick={() => handleTimelineSelect(item.value)}
              />
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
