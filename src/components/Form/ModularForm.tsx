import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Send, CheckCircle2, Sparkles } from 'lucide-react';
import { useConfig } from '../../context/ConfigContext';
import type { FormConfig, FormField } from '../../lib/config';
import {
  createFormSession,
  extractUTMParams,
  submitFormResponse,
  getCurrentSessionId,
  trackPageVisit,
} from '../../lib/tracking';

// Get default form config
const getDefaultFormConfig = (): FormConfig => ({
  type: 'single-page',
  theme: 'glass',
  hero: {
    headline: 'Get Started Today',
    subheadline: 'Fill out the form below and we\'ll be in touch.',
    showImage: false,
  },
  trustBadges: [],
  benefits: [],
  fields: [
    { id: 'full_name', type: 'text', label: 'Full Name', required: true, enabled: true },
    { id: 'email', type: 'email', label: 'Email', required: true, enabled: true },
    { id: 'phone', type: 'phone', label: 'Phone', required: false, enabled: true },
  ],
  submitButton: { text: 'Submit', loadingText: 'Submitting...' },
  successPage: { headline: 'Thank You!', message: 'We\'ll be in touch soon.', showConfetti: false },
});

export function ModularForm() {
  const config = useConfig();
  const formConfig = config.formConfig || getDefaultFormConfig();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Initialize session
  useEffect(() => {
    const initSession = async () => {
      try {
        const utmParams = extractUTMParams(searchParams);
        await trackPageVisit(utmParams);

        let existingSessionId = getCurrentSessionId();
        if (!existingSessionId) {
          const { sessionId: newSessionId } = await createFormSession(utmParams);
          existingSessionId = newSessionId;
        }
        setSessionId(existingSessionId);
      } catch (error) {
        console.error('Error initializing session:', error);
      }
    };
    initSession();
  }, []);

  // Get enabled fields only
  const enabledFields = formConfig.fields.filter(f => f.enabled);

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    enabledFields.forEach(field => {
      if (field.required && !formData[field.id]) {
        newErrors[field.id] = `${field.label} is required`;
      }
      if (field.type === 'email' && formData[field.id]) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(formData[field.id])) {
          newErrors[field.id] = 'Please enter a valid email';
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;
    if (!sessionId) return;

    setIsSubmitting(true);

    try {
      await submitFormResponse(sessionId, formData);
      navigate('/success');
    } catch (error) {
      console.error('Error submitting form:', error);
      alert('There was an error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Update field value
  const updateField = (fieldId: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
    if (errors[fieldId]) {
      setErrors(prev => ({ ...prev, [fieldId]: '' }));
    }
  };

  // Render a single field
  const renderField = (field: FormField) => {
    const baseInputClass = `w-full px-4 py-3 rounded-xl border-2 transition-all duration-200 bg-white/80 backdrop-blur-sm
      focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500
      ${errors[field.id] ? 'border-red-400' : 'border-gray-200 hover:border-purple-300'}`;

    switch (field.type) {
      case 'text':
      case 'email':
      case 'phone':
        return (
          <div key={field.id} className="space-y-1.5">
            <label className="block text-sm font-semibold text-gray-700">
              {field.label} {field.required && <span className="text-purple-500">*</span>}
            </label>
            <input
              type={field.type === 'phone' ? 'tel' : field.type}
              placeholder={field.placeholder}
              value={formData[field.id] || ''}
              onChange={(e) => updateField(field.id, e.target.value)}
              className={baseInputClass}
            />
            {errors[field.id] && (
              <p className="text-red-500 text-xs mt-1">{errors[field.id]}</p>
            )}
          </div>
        );

      case 'select':
        return (
          <div key={field.id} className="space-y-1.5">
            <label className="block text-sm font-semibold text-gray-700">
              {field.label} {field.required && <span className="text-purple-500">*</span>}
            </label>
            <select
              value={formData[field.id] || ''}
              onChange={(e) => updateField(field.id, e.target.value)}
              className={baseInputClass}
            >
              <option value="">{field.placeholder || 'Select an option'}</option>
              {field.options?.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {errors[field.id] && (
              <p className="text-red-500 text-xs mt-1">{errors[field.id]}</p>
            )}
          </div>
        );

      case 'radio':
        const gridClass = field.gridCols === 3 ? 'grid-cols-3' : field.gridCols === 2 ? 'grid-cols-2' : 'grid-cols-1';
        return (
          <div key={field.id} className="space-y-2">
            <label className="block text-sm font-semibold text-gray-700">
              {field.label} {field.required && <span className="text-purple-500">*</span>}
            </label>
            <div className={`grid ${gridClass} gap-3`}>
              {field.options?.map(opt => (
                <motion.button
                  key={opt.value}
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => updateField(field.id, opt.value)}
                  className={`p-4 rounded-xl border-2 text-left transition-all duration-200
                    ${formData[field.id] === opt.value
                      ? 'border-purple-500 bg-purple-50 shadow-lg shadow-purple-500/20'
                      : 'border-gray-200 bg-white/80 hover:border-purple-300 hover:bg-purple-50/50'
                    }`}
                >
                  {opt.icon && <span className="text-2xl mb-2 block">{opt.icon}</span>}
                  <span className="font-semibold text-gray-900 block">{opt.label}</span>
                  {opt.description && (
                    <span className="text-xs text-gray-500">{opt.description}</span>
                  )}
                </motion.button>
              ))}
            </div>
            {errors[field.id] && (
              <p className="text-red-500 text-xs mt-1">{errors[field.id]}</p>
            )}
          </div>
        );

      case 'textarea':
        return (
          <div key={field.id} className="space-y-1.5">
            <label className="block text-sm font-semibold text-gray-700">
              {field.label} {field.required && <span className="text-purple-500">*</span>}
            </label>
            <textarea
              placeholder={field.placeholder}
              value={formData[field.id] || ''}
              onChange={(e) => updateField(field.id, e.target.value)}
              rows={4}
              className={baseInputClass}
            />
            {errors[field.id] && (
              <p className="text-red-500 text-xs mt-1">{errors[field.id]}</p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Main Content */}
      <div className="relative z-10 py-12 px-4 min-h-screen flex items-center justify-center">
        <div className="max-w-5xl w-full mx-auto">
          <div className="grid lg:grid-cols-2 gap-8 items-center">

            {/* Left Column - Hero Content */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              className="text-white space-y-6"
            >
              {/* Logo */}
              <img
                src={config.company.logo}
                alt={config.company.name}
                className="h-12 w-auto"
              />

              {/* Headline */}
              <div>
                <h1 className="text-4xl lg:text-5xl font-bold leading-tight">
                  <span className="bg-gradient-to-r from-white via-purple-200 to-cyan-200 bg-clip-text text-transparent">
                    {formConfig.hero.headline}
                  </span>
                </h1>
                <p className="mt-4 text-lg text-purple-200/80 leading-relaxed">
                  {formConfig.hero.subheadline}
                </p>
              </div>

              {/* Benefits */}
              {formConfig.benefits.length > 0 && (
                <div className="space-y-3 pt-4">
                  {formConfig.benefits.map((benefit, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.1 }}
                      className="flex items-start gap-3"
                    >
                      <CheckCircle2 className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                      <span className="text-purple-100/90">{benefit}</span>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Trust Badges */}
              {formConfig.trustBadges.length > 0 && (
                <div className="flex flex-wrap gap-3 pt-4">
                  {formConfig.trustBadges.map((badge, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.5 + i * 0.1 }}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20"
                    >
                      <span>{badge.icon}</span>
                      <span className="text-sm text-white/90">{badge.text}</span>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Right Column - Form */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl shadow-purple-500/20 p-8 border border-white/50">
                {/* Form Header */}
                <div className="flex items-center gap-2 mb-6">
                  <Sparkles className="w-5 h-5 text-purple-500" />
                  <span className="text-sm font-medium text-purple-600">Free Consultation</span>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  {enabledFields.map(field => renderField(field))}

                  {/* Submit Button */}
                  <motion.button
                    type="submit"
                    disabled={isSubmitting}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`w-full py-4 px-6 rounded-xl font-semibold text-white text-lg
                      flex items-center justify-center gap-2 transition-all duration-200
                      ${isSubmitting
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40'
                      }`}
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {formConfig.submitButton.loadingText}
                      </>
                    ) : (
                      <>
                        {formConfig.submitButton.text}
                        <Send className="w-5 h-5" />
                      </>
                    )}
                  </motion.button>

                  {/* Privacy Note */}
                  <p className="text-xs text-center text-gray-500">
                    By submitting, you agree to our privacy policy. We'll never share your information.
                  </p>
                </form>
              </div>
            </motion.div>

          </div>
        </div>
      </div>
    </div>
  );
}
