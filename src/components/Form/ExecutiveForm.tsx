import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfig } from '../../context/ConfigContext';

// Fire-and-forget POST helper for the public tracking API
async function trackingPost(endpoint: string, body: Record<string, any>): Promise<Response> {
  return fetch(`/api/tracking${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface FormData {
  // Step 1: AI Adoption
  ai_adoption: string;
  // Step 2: Challenges
  challenges: string[];
  // Step 3: Company
  company_name: string;
  industry: string;
  company_size: string;
  // Step 4: Training Needs
  employees_to_train: string;
  departments: string[];
  timeline: string;
  // Step 5: Contact
  full_name: string;
  job_title: string;
  email: string;
  phone: string;
}

const initialFormData: FormData = {
  ai_adoption: '',
  challenges: [],
  company_name: '',
  industry: '',
  company_size: '',
  employees_to_train: '',
  departments: [],
  timeline: '',
  full_name: '',
  job_title: '',
  email: '',
  phone: '',
};

// Session tracking
const getSessionId = () => {
  let sessionId = sessionStorage.getItem('form_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('form_session_id', sessionId);
  }
  return sessionId;
};

export function ExecutiveForm() {
  const config = useConfig();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [highestStep, setHighestStep] = useState(1);

  const totalSteps = 5;
  const sessionId = getSessionId();

  // Track step progress for funnel analytics
  useEffect(() => {
    if (currentStep > highestStep) {
      setHighestStep(currentStep);
      trackStepProgress(currentStep);
    }
  }, [currentStep, highestStep]);

  const trackStepProgress = async (step: number) => {
    try {
      // Create/update session with current step in metadata (backend upserts on session_id)
      await trackingPost('/sessions', {
        session_id: sessionId,
        status: step === 1 ? 'started' : 'in_progress',
        metadata: {
          current_step: step,
          highest_step: step,
          partial_data: formData,
        }
      });
    } catch (error) {
      // Non-fatal - don't break the form if tracking fails
      console.warn('Step tracking error (non-fatal):', error);
    }
  };

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setDirection('forward');
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setDirection('backward');
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // First ensure session exists in form_sessions (backend upserts on session_id)
      try {
        await trackingPost('/sessions', {
          session_id: sessionId,
          status: 'completed',
          completed_at: new Date().toISOString(),
          metadata: {
            ai_adoption: formData.ai_adoption,
            challenges: formData.challenges,
            company_size: formData.company_size,
            employees_to_train: formData.employees_to_train,
            departments: formData.departments,
          }
        });
      } catch (sessionError) {
        console.warn('Session tracking error (non-fatal):', sessionError);
      }

      // Save to form_responses table
      const response = await trackingPost('/responses', {
        session_id: sessionId,
        full_name: formData.full_name,
        email: formData.email,
        phone: formData.phone,
        organization: formData.company_name,
        industry: formData.industry,
        timeline: formData.timeline,
        notes: `Job Title: ${formData.job_title}\nAI Adoption: ${formData.ai_adoption}\nChallenges: ${formData.challenges.join(', ')}\nCompany Size: ${formData.company_size}\nEmployees to Train: ${formData.employees_to_train}\nDepartments: ${formData.departments.join(', ')}`,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(body.detail || `Failed to submit form: ${response.status}`);
      }

      navigate('/success');
    } catch (error) {
      console.error('Error submitting form:', error);
      alert('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateFormData = (field: keyof FormData, value: string | string[]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleArrayValue = (field: 'challenges' | 'departments', value: string) => {
    setFormData(prev => {
      const current = prev[field];
      const updated = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [field]: updated };
    });
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1: return formData.ai_adoption !== '';
      case 2: return formData.challenges.length > 0;
      case 3: return formData.company_name !== '' && formData.industry !== '' && formData.company_size !== '';
      case 4: return formData.employees_to_train !== '' && formData.departments.length > 0 && formData.timeline !== '';
      case 5: return formData.full_name !== '' && formData.email !== '' && formData.phone !== '';
      default: return false;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-100 via-cyan-50 to-white relative overflow-hidden">
      {/* Animated background elements - light sky blue theme */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-sky-300/40 rounded-full blur-3xl animate-pulse" />
        <div className="absolute top-1/2 -left-40 w-96 h-96 bg-cyan-300/30 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute -bottom-40 right-1/3 w-80 h-80 bg-sky-200/50 rounded-full blur-3xl animate-pulse delay-500" />
        <div className="absolute top-1/4 right-1/2 w-64 h-64 bg-cyan-200/40 rounded-full blur-3xl animate-pulse delay-700" />
        {/* Floating particles */}
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-sky-400/50 rounded-full animate-float" />
        <div className="absolute top-1/3 right-1/4 w-3 h-3 bg-cyan-400/50 rounded-full animate-float-delayed" />
        <div className="absolute bottom-1/4 left-1/3 w-2 h-2 bg-sky-500/40 rounded-full animate-float" />
      </div>

      {/* Header */}
      <header className="relative z-10 pt-8 pb-4">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {config.company?.logo && (
              <img src={config.company.logo} alt={config.company.name} className="h-10 w-auto" />
            )}
            <div>
              <h1 className="text-slate-800 font-bold text-xl">{config.company?.name || 'AI Training'}</h1>
              <p className="text-slate-500 text-sm">{config.company?.tagline}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="relative z-10 max-w-2xl mx-auto px-6 mb-8">
        <div className="flex items-center justify-between mb-2">
          {[1, 2, 3, 4, 5].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all duration-500 ${
                  step < currentStep
                    ? 'bg-cyan-500 text-white scale-90'
                    : step === currentStep
                    ? 'bg-cyan-500 text-white scale-110 shadow-lg shadow-cyan-500/30'
                    : 'bg-white/60 text-slate-400 border border-slate-200'
                }`}
              >
                {step < currentStep ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step
                )}
              </div>
              {step < 5 && (
                <div className={`w-12 sm:w-20 h-1 mx-1 rounded-full transition-all duration-500 ${
                  step < currentStep ? 'bg-cyan-500' : 'bg-slate-200'
                }`} />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-slate-500 px-1">
          <span>AI Maturity</span>
          <span>Challenges</span>
          <span>Company</span>
          <span>Training</span>
          <span>Contact</span>
        </div>
      </div>

      {/* Form Container */}
      <div className="relative z-10 max-w-2xl mx-auto px-6 pb-12">
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl border border-white shadow-xl shadow-cyan-500/10 overflow-hidden">
          {/* Step Content */}
          <div className="p-8 min-h-[400px]">
            <div
              key={currentStep}
              className={`animate-${direction === 'forward' ? 'slide-in-right' : 'slide-in-left'}`}
            >
              {currentStep === 1 && (
                <Step1AIAdoption
                  value={formData.ai_adoption}
                  onChange={(val) => updateFormData('ai_adoption', val)}
                />
              )}
              {currentStep === 2 && (
                <Step2Challenges
                  selected={formData.challenges}
                  onToggle={(val) => toggleArrayValue('challenges', val)}
                />
              )}
              {currentStep === 3 && (
                <Step3Company
                  formData={formData}
                  updateFormData={updateFormData}
                />
              )}
              {currentStep === 4 && (
                <Step4Training
                  formData={formData}
                  updateFormData={updateFormData}
                  toggleDepartment={(val) => toggleArrayValue('departments', val)}
                />
              )}
              {currentStep === 5 && (
                <Step5Contact
                  formData={formData}
                  updateFormData={updateFormData}
                />
              )}
            </div>
          </div>

          {/* Navigation */}
          <div className="px-8 py-6 bg-slate-50/80 border-t border-slate-100 flex justify-between items-center">
            <button
              onClick={handleBack}
              disabled={currentStep === 1}
              className={`px-6 py-3 rounded-xl font-medium transition-all duration-300 ${
                currentStep === 1
                  ? 'opacity-0 pointer-events-none'
                  : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              ← Back
            </button>

            {currentStep < totalSteps ? (
              <button
                onClick={handleNext}
                disabled={!canProceed()}
                className={`px-8 py-3 rounded-xl font-semibold transition-all duration-300 ${
                  canProceed()
                    ? 'bg-gradient-to-r from-cyan-500 to-sky-400 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:scale-105'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                Continue →
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!canProceed() || isSubmitting}
                className={`px-8 py-3 rounded-xl font-semibold transition-all duration-300 ${
                  canProceed() && !isSubmitting
                    ? 'bg-gradient-to-r from-cyan-500 to-sky-400 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:scale-105'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Submitting...
                  </span>
                ) : (
                  'Get My Custom Plan →'
                )}
              </button>
            )}
          </div>
        </div>

        {/* Trust Badges */}
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          {config.formConfig?.trustBadges?.map((badge, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-4 py-2 bg-white/70 backdrop-blur rounded-full border border-slate-200 shadow-sm"
            >
              <span>{badge.icon}</span>
              <span className="text-slate-600 text-sm">{badge.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Custom Animations */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.5; }
          50% { transform: translateY(-20px) rotate(180deg); opacity: 1; }
        }
        @keyframes float-delayed {
          0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.3; }
          50% { transform: translateY(-30px) rotate(-180deg); opacity: 0.8; }
        }
        @keyframes slide-in-right {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slide-in-left {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-float { animation: float 6s ease-in-out infinite; }
        .animate-float-delayed { animation: float-delayed 8s ease-in-out infinite; }
        .animate-slide-in-right { animation: slide-in-right 0.4s ease-out; }
        .animate-slide-in-left { animation: slide-in-left 0.4s ease-out; }
      `}</style>
    </div>
  );
}

// Step 1: AI Adoption Level
function Step1AIAdoption({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const options = [
    { id: 'exploring', icon: '🔍', title: 'Just Exploring', description: 'Curious about AI capabilities' },
    { id: 'beginner', icon: '🌱', title: 'Getting Started', description: 'Using basic AI tools like ChatGPT' },
    { id: 'intermediate', icon: '📈', title: 'Growing', description: 'Some teams actively using AI' },
    { id: 'advanced', icon: '🚀', title: 'Advanced', description: 'AI integrated into workflows' },
    { id: 'leading', icon: '⭐', title: 'Industry Leader', description: 'AI-first organization' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Where is your organization on the AI journey?</h2>
      <p className="text-slate-500 mb-8">This helps us recommend the right training path for your team.</p>

      <div className="grid gap-3">
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            className={`w-full p-4 rounded-2xl border-2 transition-all duration-300 text-left flex items-center gap-4 group ${
              value === option.id
                ? 'border-cyan-400 bg-cyan-50 scale-[1.02]'
                : 'border-slate-200 hover:border-cyan-300 hover:bg-slate-50'
            }`}
          >
            <span className={`text-3xl transition-transform duration-300 ${value === option.id ? 'scale-110' : 'group-hover:scale-110'}`}>
              {option.icon}
            </span>
            <div>
              <h3 className="text-slate-800 font-semibold">{option.title}</h3>
              <p className="text-slate-500 text-sm">{option.description}</p>
            </div>
            {value === option.id && (
              <div className="ml-auto">
                <div className="w-6 h-6 rounded-full bg-cyan-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// Step 2: Challenges
function Step2Challenges({ selected, onToggle }: { selected: string[]; onToggle: (val: string) => void }) {
  const challenges = [
    { id: 'productivity', icon: '⚡', title: 'Boost Productivity', description: 'Work smarter, not harder' },
    { id: 'automation', icon: '🤖', title: 'Automate Tasks', description: 'Reduce repetitive work' },
    { id: 'skills_gap', icon: '📚', title: 'Close Skills Gap', description: 'Upskill workforce for AI era' },
    { id: 'competitive', icon: '🏆', title: 'Stay Competitive', description: 'Keep up with industry trends' },
    { id: 'innovation', icon: '💡', title: 'Drive Innovation', description: 'Create new solutions with AI' },
    { id: 'cost_reduction', icon: '💰', title: 'Reduce Costs', description: 'Optimize operations' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">What challenges are you looking to solve?</h2>
      <p className="text-slate-500 mb-8">Select all that apply. We'll customize your training focus.</p>

      <div className="grid grid-cols-2 gap-3">
        {challenges.map((challenge) => (
          <button
            key={challenge.id}
            onClick={() => onToggle(challenge.id)}
            className={`p-4 rounded-2xl border-2 transition-all duration-300 text-left group ${
              selected.includes(challenge.id)
                ? 'border-cyan-400 bg-cyan-50 scale-[1.02]'
                : 'border-slate-200 hover:border-cyan-300 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <span className={`text-2xl transition-transform duration-300 ${selected.includes(challenge.id) ? 'scale-110' : 'group-hover:scale-110'}`}>
                {challenge.icon}
              </span>
              {selected.includes(challenge.id) && (
                <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
            <h3 className="text-slate-800 font-semibold text-sm">{challenge.title}</h3>
            <p className="text-slate-500 text-xs">{challenge.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// Step 3: Company Info
function Step3Company({ formData, updateFormData }: { formData: FormData; updateFormData: (field: keyof FormData, value: string) => void }) {
  const industries = [
    { id: 'technology', icon: '💻', label: 'Technology' },
    { id: 'finance', icon: '🏦', label: 'Finance & Banking' },
    { id: 'healthcare', icon: '🏥', label: 'Healthcare' },
    { id: 'manufacturing', icon: '🏭', label: 'Manufacturing' },
    { id: 'retail', icon: '🛒', label: 'Retail & E-commerce' },
    { id: 'education', icon: '🎓', label: 'Education' },
    { id: 'government', icon: '🏛️', label: 'Government' },
    { id: 'other', icon: '🏢', label: 'Other' },
  ];

  const companySizes = [
    { id: 'startup', icon: '🚀', label: '1-50', description: 'Startup' },
    { id: 'sme', icon: '📈', label: '51-200', description: 'SME' },
    { id: 'midsize', icon: '🏢', label: '201-1000', description: 'Mid-size' },
    { id: 'enterprise', icon: '🌐', label: '1000+', description: 'Enterprise' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Tell us about your organization</h2>
      <p className="text-slate-500 mb-6">So we can tailor the training to your industry context.</p>

      {/* Company Name */}
      <div className="mb-6">
        <label className="block text-slate-600 text-sm font-medium mb-2">Company Name</label>
        <input
          type="text"
          value={formData.company_name}
          onChange={(e) => updateFormData('company_name', e.target.value)}
          placeholder="Your company name"
          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 transition-all"
        />
      </div>

      {/* Industry */}
      <div className="mb-6">
        <label className="block text-slate-600 text-sm font-medium mb-3">Industry</label>
        <div className="grid grid-cols-4 gap-2">
          {industries.map((industry) => (
            <button
              key={industry.id}
              onClick={() => updateFormData('industry', industry.id)}
              className={`p-3 rounded-xl border-2 transition-all duration-300 text-center ${
                formData.industry === industry.id
                  ? 'border-cyan-400 bg-cyan-50'
                  : 'border-slate-200 hover:border-cyan-300 hover:bg-slate-50'
              }`}
            >
              <span className="text-xl block mb-1">{industry.icon}</span>
              <span className="text-slate-500 text-xs">{industry.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Company Size */}
      <div>
        <label className="block text-slate-600 text-sm font-medium mb-3">Company Size</label>
        <div className="grid grid-cols-4 gap-2">
          {companySizes.map((size) => (
            <button
              key={size.id}
              onClick={() => updateFormData('company_size', size.id)}
              className={`p-4 rounded-xl border-2 transition-all duration-300 text-center ${
                formData.company_size === size.id
                  ? 'border-cyan-400 bg-cyan-50'
                  : 'border-slate-200 hover:border-cyan-300 hover:bg-slate-50'
              }`}
            >
              <span className="text-2xl block mb-1">{size.icon}</span>
              <span className="text-slate-800 font-semibold text-sm block">{size.label}</span>
              <span className="text-slate-500 text-xs">{size.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Step 4: Training Needs
function Step4Training({ formData, updateFormData, toggleDepartment }: {
  formData: FormData;
  updateFormData: (field: keyof FormData, value: string) => void;
  toggleDepartment: (val: string) => void;
}) {
  const employeeOptions = [
    { id: '1-10', label: '1-10', icon: '👤' },
    { id: '11-50', label: '11-50', icon: '👥' },
    { id: '51-100', label: '51-100', icon: '👨‍👩‍👧‍👦' },
    { id: '100+', label: '100+', icon: '🏢' },
  ];

  const departments = [
    { id: 'sales', icon: '💼', label: 'Sales' },
    { id: 'marketing', icon: '📢', label: 'Marketing' },
    { id: 'hr', icon: '👥', label: 'HR' },
    { id: 'it', icon: '💻', label: 'IT' },
    { id: 'operations', icon: '⚙️', label: 'Operations' },
    { id: 'finance', icon: '📊', label: 'Finance' },
    { id: 'customer_service', icon: '🎧', label: 'Customer Service' },
    { id: 'all', icon: '🌟', label: 'All Departments' },
  ];

  const timelines = [
    { id: 'asap', icon: '🔥', label: 'ASAP', description: 'Within 2 weeks' },
    { id: 'this_quarter', icon: '📅', label: 'This Quarter', description: 'Next 3 months' },
    { id: 'next_quarter', icon: '🗓️', label: 'Next Quarter', description: '3-6 months' },
    { id: 'exploring', icon: '🔍', label: 'Just Exploring', description: 'No timeline yet' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Let's plan your training program</h2>
      <p className="text-slate-500 mb-6">Help us understand the scope of your training needs.</p>

      {/* Number of Employees */}
      <div className="mb-6">
        <label className="block text-slate-600 text-sm font-medium mb-3">How many employees to train?</label>
        <div className="grid grid-cols-4 gap-2">
          {employeeOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => updateFormData('employees_to_train', option.id)}
              className={`p-3 rounded-xl border-2 transition-all duration-300 text-center ${
                formData.employees_to_train === option.id
                  ? 'border-cyan-400 bg-cyan-50'
                  : 'border-slate-200 hover:border-cyan-300 hover:bg-slate-50'
              }`}
            >
              <span className="text-xl block mb-1">{option.icon}</span>
              <span className="text-slate-800 font-semibold text-sm">{option.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Departments */}
      <div className="mb-6">
        <label className="block text-slate-600 text-sm font-medium mb-3">Which departments? (Select all)</label>
        <div className="grid grid-cols-4 gap-2">
          {departments.map((dept) => (
            <button
              key={dept.id}
              onClick={() => toggleDepartment(dept.id)}
              className={`p-3 rounded-xl border-2 transition-all duration-300 text-center ${
                formData.departments.includes(dept.id)
                  ? 'border-cyan-400 bg-cyan-50'
                  : 'border-slate-200 hover:border-cyan-300 hover:bg-slate-50'
              }`}
            >
              <span className="text-lg block mb-1">{dept.icon}</span>
              <span className="text-slate-500 text-xs">{dept.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div>
        <label className="block text-slate-600 text-sm font-medium mb-3">When do you want to start?</label>
        <div className="grid grid-cols-2 gap-3">
          {timelines.map((timeline) => (
            <button
              key={timeline.id}
              onClick={() => updateFormData('timeline', timeline.id)}
              className={`p-4 rounded-xl border-2 transition-all duration-300 text-left flex items-center gap-3 ${
                formData.timeline === timeline.id
                  ? 'border-green-400 bg-green-500/20'
                  : 'border-slate-200 hover:border-cyan-300 hover:bg-slate-50'
              }`}
            >
              <span className="text-2xl">{timeline.icon}</span>
              <div>
                <span className="text-slate-800 font-semibold block">{timeline.label}</span>
                <span className="text-slate-500 text-xs">{timeline.description}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Step 5: Contact Info
function Step5Contact({ formData, updateFormData }: { formData: FormData; updateFormData: (field: keyof FormData, value: string) => void }) {
  const jobTitles = [
    { id: 'c_level', label: 'C-Level Executive' },
    { id: 'director', label: 'Director' },
    { id: 'manager', label: 'Manager' },
    { id: 'team_lead', label: 'Team Lead' },
    { id: 'hr_training', label: 'HR / L&D' },
    { id: 'other', label: 'Other' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Almost there! How can we reach you?</h2>
      <p className="text-slate-500 mb-6">Our training specialists will contact you within 24 hours.</p>

      <div className="space-y-4">
        {/* Full Name */}
        <div>
          <label className="block text-slate-600 text-sm font-medium mb-2">Full Name *</label>
          <input
            type="text"
            value={formData.full_name}
            onChange={(e) => updateFormData('full_name', e.target.value)}
            placeholder="Your full name"
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 transition-all"
          />
        </div>

        {/* Job Title */}
        <div>
          <label className="block text-slate-600 text-sm font-medium mb-2">Job Title *</label>
          <div className="grid grid-cols-3 gap-2">
            {jobTitles.map((title) => (
              <button
                key={title.id}
                onClick={() => updateFormData('job_title', title.id)}
                className={`px-3 py-2 rounded-xl border-2 transition-all duration-300 text-sm ${
                  formData.job_title === title.id
                    ? 'border-cyan-400 bg-cyan-50 text-cyan-700'
                    : 'border-slate-200 text-slate-600 hover:border-cyan-300 hover:bg-slate-50'
                }`}
              >
                {title.label}
              </button>
            ))}
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="block text-slate-600 text-sm font-medium mb-2">Work Email *</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => updateFormData('email', e.target.value)}
            placeholder="you@company.com"
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 transition-all"
          />
        </div>

        {/* Phone */}
        <div>
          <label className="block text-slate-600 text-sm font-medium mb-2">Phone Number *</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => updateFormData('phone', e.target.value)}
            placeholder="+60 12-345 6789"
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 transition-all"
          />
        </div>
      </div>

      {/* Privacy Note */}
      <p className="mt-6 text-slate-400 text-xs text-center">
        By submitting, you agree to our Privacy Policy. We'll never share your information.
      </p>
    </div>
  );
}
