import { motion } from 'framer-motion';
import { CheckCircle2, Mail, Phone, MessageSquare, User, Building } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTracking } from '../../hooks/useTracking';

const contactSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  organization: z.string().min(2, 'Organization name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().min(10, 'Please enter a valid phone number'),
  contact_method: z.string().min(1, 'Please select a contact method'),
  notes: z.string().optional(),
});

type ContactFormData = z.infer<typeof contactSchema>;

interface Step4Props {
  formData: Partial<ContactFormData>;
  onSubmit: (data: ContactFormData) => void;
  isSubmitting: boolean;
  industry: string;
  challenge: string;
  solutions: string[];
}

export function Step4({
  formData,
  onSubmit,
  isSubmitting,
  industry,
  challenge,
  solutions,
}: Step4Props) {
  const { trackClick } = useTracking(4);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: formData,
  });

  const getBenefits = () => {
    const benefits = [];

    if (challenge.includes('repetitive')) {
      benefits.push('Automate repetitive tasks and free up your workforce');
    } else if (challenge.includes('transport')) {
      benefits.push('Streamline material transport with AGV/AMR solutions');
    } else if (challenge.includes('Labor costs')) {
      benefits.push('Reduce long-term operational and labor costs');
    } else if (challenge.includes('safety')) {
      benefits.push('Improve workplace safety with automated systems');
    } else if (challenge.includes('Scaling')) {
      benefits.push('Scale your operations efficiently with flexible automation');
    } else if (challenge.includes('inventory')) {
      benefits.push('Optimize inventory management with smart robotics');
    }

    if (industry.includes('Manufacturing')) {
      benefits.push('Increase production efficiency and throughput');
    } else if (industry.includes('Logistics')) {
      benefits.push('Enhance logistics and distribution speed');
    } else if (industry.includes('Warehousing')) {
      benefits.push('Maximize warehouse space utilization');
    }

    if (solutions.includes('AGV')) {
      benefits.push('Implement reliable AGV systems for predictable routes');
    }
    if (solutions.includes('AMR')) {
      benefits.push('Deploy intelligent AMR for dynamic navigation');
    }

    return benefits.slice(0, 3); // Show top 3 benefits
  };

  const handleFormSubmit = (data: ContactFormData) => {
    trackClick('submit_form', { has_notes: !!data.notes });
    onSubmit(data);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      transition={{ duration: 0.3 }}
      className="max-w-3xl mx-auto"
    >
      {/* Results Section */}
      <motion.div
        className="card mb-8 bg-gradient-to-br from-primary to-primary-dark text-white"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-start gap-4">
          <CheckCircle2 size={48} className="flex-shrink-0 mt-1" />
          <div>
            <h2 className="text-2xl font-bold mb-3">Great News!</h2>
            <p className="text-lg mb-4 opacity-90">
              Based on your responses, robotics automation can definitely help your
              organization!
            </p>

            <div className="space-y-2">
              {getBenefits().map((benefit, index) => (
                <motion.div
                  key={index}
                  className="flex items-start gap-2"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                >
                  <CheckCircle2 size={20} className="flex-shrink-0 mt-0.5" />
                  <span className="text-white opacity-90">{benefit}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Contact Form */}
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h3 className="text-2xl font-bold text-gray-900 mb-2">
          Let's Connect You With Our Robotics Experts
        </h3>
        <p className="text-gray-600 mb-6">
          Fill in your details and we'll reach out to discuss your custom robotics
          solution
        </p>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <User size={16} className="inline mr-1" />
              Full Name *
            </label>
            <input
              {...register('full_name')}
              type="text"
              className="input-field"
              placeholder="John Doe"
            />
            {errors.full_name && (
              <p className="text-red-500 text-sm mt-1">{errors.full_name.message}</p>
            )}
          </div>

          {/* Organization */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <Building size={16} className="inline mr-1" />
              Organization Name *
            </label>
            <input
              {...register('organization')}
              type="text"
              className="input-field"
              placeholder="ABC Manufacturing Inc."
            />
            {errors.organization && (
              <p className="text-red-500 text-sm mt-1">{errors.organization.message}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <Mail size={16} className="inline mr-1" />
              Email Address *
            </label>
            <input
              {...register('email')}
              type="email"
              className="input-field"
              placeholder="john@company.com"
            />
            {errors.email && (
              <p className="text-red-500 text-sm mt-1">{errors.email.message}</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <Phone size={16} className="inline mr-1" />
              Phone Number *
            </label>
            <input
              {...register('phone')}
              type="tel"
              className="input-field"
              placeholder="+1 (555) 123-4567"
            />
            {errors.phone && (
              <p className="text-red-500 text-sm mt-1">{errors.phone.message}</p>
            )}
          </div>

          {/* Contact Method */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Preferred Contact Method *
            </label>
            <div className="grid grid-cols-3 gap-3">
              {['Email', 'Phone', 'WhatsApp'].map((method) => (
                <label
                  key={method}
                  className="flex items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-all hover:border-primary"
                >
                  <input
                    {...register('contact_method')}
                    type="radio"
                    value={method}
                    className="mr-2"
                  />
                  <span className="font-medium">{method}</span>
                </label>
              ))}
            </div>
            {errors.contact_method && (
              <p className="text-red-500 text-sm mt-1">
                {errors.contact_method.message}
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <MessageSquare size={16} className="inline mr-1" />
              Additional Notes (Optional)
            </label>
            <textarea
              {...register('notes')}
              className="input-field resize-none"
              rows={4}
              placeholder="Tell us more about your project or any specific requirements..."
            />
          </div>

          {/* Submit Button */}
          <motion.button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary w-full text-lg"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Submitting...
              </span>
            ) : (
              'Get Your Custom Robotics Solution'
            )}
          </motion.button>
        </form>
      </motion.div>
    </motion.div>
  );
}
