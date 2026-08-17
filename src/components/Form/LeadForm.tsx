import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Header } from '../Header';
import { ProgressBar } from './ProgressBar';
import { Step1 } from './Step1';
import { Step2 } from './Step2';
import { Step3 } from './Step3';
import { Step4 } from './Step4';
import type { FormData } from '../../types/form';
import {
  createFormSession,
  extractUTMParams,
  updateSessionStatus,
  submitFormResponse,
  getCurrentSessionId,
  trackPageVisit,
} from '../../lib/tracking';
import { useTracking } from '../../hooks/useTracking';
import { useConfig } from '../../context/ConfigContext';

const TOTAL_STEPS = 4;

export function LeadForm() {
  const config = useConfig();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<FormData>>({
    industry: '',
    challenge: '',
    automation_level: '',
    facility_size: '',
    solutions_interest: [],
    timeline: '',
    full_name: '',
    organization: '',
    email: '',
    phone: '',
    contact_method: '',
    notes: '',
  });

  const { track, trackClick, trackEnterStep, trackExitStep } = useTracking(currentStep);

  // Track page visit and initialize session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        // Extract UTM params first
        const utmParams = extractUTMParams(searchParams);

        // Track page visit IMMEDIATELY (before form start)
        await trackPageVisit(utmParams);

        // Check if session already exists
        let existingSessionId = getCurrentSessionId();

        if (!existingSessionId) {
          // Create new session
          const { sessionId: newSessionId } = await createFormSession(utmParams);
          existingSessionId = newSessionId;
          track('form_started');
        }

        setSessionId(existingSessionId);
        trackEnterStep(1, 'Industry & Challenge');
      } catch (error) {
        console.error('Error initializing session:', error);
      }
    };

    initSession();
  }, []); // Run once on mount

  // Track step changes
  useEffect(() => {
    if (sessionId && currentStep > 1) {
      trackEnterStep(currentStep, getStepName(currentStep));
    }
  }, [currentStep, sessionId]);

  const getStepName = (step: number): string => {
    const names = ['Industry & Challenge', 'Operations', 'Solutions', 'Contact'];
    return names[step - 1] || 'Unknown';
  };

  const canProceedFromStep = (step: number): boolean => {
    switch (step) {
      case 1:
        return !!(formData.industry && formData.challenge);
      case 2:
        return !!(formData.automation_level && formData.facility_size);
      case 3:
        return !!(formData.solutions_interest && formData.solutions_interest.length > 0 && formData.timeline);
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!canProceedFromStep(currentStep)) {
      return;
    }

    if (sessionId) {
      trackExitStep(currentStep, getStepAnswers(currentStep));
    }

    trackClick('next_button', { from_step: currentStep });

    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);

      // Update session status
      if (sessionId && currentStep === 1) {
        updateSessionStatus(sessionId, 'in_progress');
      }
    }
  };

  const handleBack = () => {
    trackClick('back_button', { from_step: currentStep });

    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const getStepAnswers = (step: number): Record<string, any> => {
    switch (step) {
      case 1:
        return {
          industry: formData.industry,
          challenge: formData.challenge,
        };
      case 2:
        return {
          automation_level: formData.automation_level,
          facility_size: formData.facility_size,
        };
      case 3:
        return {
          solutions_interest: formData.solutions_interest,
          timeline: formData.timeline,
        };
      default:
        return {};
    }
  };

  const handleFinalSubmit = async (contactData: any) => {
    if (!sessionId) {
      console.error('No session ID available');
      return;
    }

    setIsSubmitting(true);

    try {
      const finalFormData = {
        ...formData,
        ...contactData,
      };

      // Submit to backend
      await submitFormResponse(sessionId, finalFormData);

      track('form_submitted', { lead_quality: 'qualified' });

      // Redirect to success page
      navigate('/success');
    } catch (error) {
      console.error('Error submitting form:', error);
      alert('There was an error submitting your form. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateFormData = (updates: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <Header />
      <div className="py-8 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Page Title */}
          <motion.div
            className="text-center mb-8"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              {config.form.title}
            </h1>
            <p className="text-lg text-gray-600">
              {config.form.subtitle}
            </p>
          </motion.div>

        {/* Progress Bar */}
        <ProgressBar currentStep={currentStep} totalSteps={TOTAL_STEPS} />

        {/* Form Steps */}
        <div className="bg-white rounded-2xl shadow-xl border border-blue-100 p-6 md:p-8 min-h-[500px]">
          <AnimatePresence mode="wait">
            {currentStep === 1 && (
              <Step1
                key="step1"
                industry={formData.industry || ''}
                challenge={formData.challenge || ''}
                onIndustryChange={(industry) => updateFormData({ industry })}
                onChallengeChange={(challenge) => updateFormData({ challenge })}
              />
            )}

            {currentStep === 2 && (
              <Step2
                key="step2"
                automation_level={formData.automation_level || ''}
                facility_size={formData.facility_size || ''}
                onAutomationLevelChange={(automation_level) =>
                  updateFormData({ automation_level })
                }
                onFacilitySizeChange={(facility_size) =>
                  updateFormData({ facility_size })
                }
              />
            )}

            {currentStep === 3 && (
              <Step3
                key="step3"
                solutions_interest={formData.solutions_interest || []}
                timeline={formData.timeline || ''}
                onSolutionsChange={(solutions_interest) =>
                  updateFormData({ solutions_interest })
                }
                onTimelineChange={(timeline) => updateFormData({ timeline })}
              />
            )}

            {currentStep === 4 && (
              <Step4
                key="step4"
                formData={formData}
                onSubmit={handleFinalSubmit}
                isSubmitting={isSubmitting}
                industry={formData.industry || ''}
                challenge={formData.challenge || ''}
                solutions={formData.solutions_interest || []}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Buttons */}
        {currentStep < 4 && (
          <motion.div
            className="flex justify-between mt-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <button
              onClick={handleBack}
              disabled={currentStep === 1}
              className="btn-secondary flex items-center gap-2"
            >
              <ArrowLeft size={20} />
              Back
            </button>

            <button
              onClick={handleNext}
              disabled={!canProceedFromStep(currentStep)}
              className="btn-primary flex items-center gap-2"
            >
              Next
              <ArrowRight size={20} />
            </button>
          </motion.div>
        )}
        </div>
      </div>
    </div>
  );
}
