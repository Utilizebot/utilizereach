import { motion } from 'framer-motion';

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
}

export function ProgressBar({ currentStep, totalSteps }: ProgressBarProps) {
  const progress = (currentStep / totalSteps) * 100;

  return (
    <div className="w-full mb-8">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-gray-600">
          Step {currentStep} of {totalSteps}
        </span>
        <span className="text-sm font-medium text-primary">
          {Math.round(progress)}% Complete
        </span>
      </div>
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      {/* Step indicators */}
      <div className="flex justify-between mt-4">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
          <div
            key={step}
            className="flex flex-col items-center"
          >
            <motion.div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                step < currentStep
                  ? 'bg-primary text-white'
                  : step === currentStep
                  ? 'bg-primary text-white ring-4 ring-primary ring-opacity-20'
                  : 'bg-gray-200 text-gray-500'
              }`}
              initial={{ scale: 0.8 }}
              animate={{ scale: step === currentStep ? 1.1 : 1 }}
              transition={{ duration: 0.3 }}
            >
              {step < currentStep ? '✓' : step}
            </motion.div>
            <span className="text-xs mt-1 text-gray-500 hidden sm:block">
              {step === 1 && 'Industry'}
              {step === 2 && 'Operations'}
              {step === 3 && 'Solutions'}
              {step === 4 && 'Contact'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
