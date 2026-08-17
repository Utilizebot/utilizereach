export interface FormData {
  // Step 1
  industry: string;
  challenge: string;

  // Step 2
  automation_level: string;
  facility_size: string;

  // Step 3
  solutions_interest: string[];
  timeline: string;

  // Step 4
  full_name: string;
  organization: string;
  email: string;
  phone: string;
  contact_method: string;
  notes: string;
}

export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  sales_rep_name?: string;
  sales_rep_id?: string;
}

export interface SessionData {
  sessionId: string;
  startTime: Date;
  currentStep: number;
  formData: Partial<FormData>;
  utmParams: UTMParams;
}

export type FormStep = 1 | 2 | 3 | 4;

export interface StepConfig {
  number: FormStep;
  title: string;
  description: string;
}
