import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface OptionCardProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function OptionCard({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
  disabled = false,
}: OptionCardProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`option-card text-left w-full ${selected ? 'selected' : ''} ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-start gap-4">
        <div
          className={`p-3 rounded-lg transition-colors ${
            selected ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <Icon size={24} />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg mb-1">{title}</h3>
          {description && (
            <p className="text-sm text-gray-600">{description}</p>
          )}
        </div>
        {selected && (
          <motion.div
            className="text-primary text-2xl"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          >
            ✓
          </motion.div>
        )}
      </div>
    </motion.button>
  );
}
