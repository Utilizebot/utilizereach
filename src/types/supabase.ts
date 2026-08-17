export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      form_sessions: {
        Row: {
          id: string
          session_id: string
          utm_source: string | null
          utm_medium: string | null
          utm_campaign: string | null
          utm_content: string | null
          sales_rep_name: string | null
          sales_rep_id: string | null
          user_agent: string | null
          ip_address: string | null
          referrer: string | null
          landing_page: string | null
          device_type: string | null
          browser: string | null
          country: string | null
          created_at: string
          completed_at: string | null
          status: 'started' | 'in_progress' | 'completed' | 'abandoned'
        }
        Insert: {
          id?: string
          session_id: string
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          sales_rep_name?: string | null
          sales_rep_id?: string | null
          user_agent?: string | null
          ip_address?: string | null
          referrer?: string | null
          landing_page?: string | null
          device_type?: string | null
          browser?: string | null
          country?: string | null
          created_at?: string
          completed_at?: string | null
          status?: 'started' | 'in_progress' | 'completed' | 'abandoned'
        }
        Update: {
          id?: string
          session_id?: string
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          sales_rep_name?: string | null
          sales_rep_id?: string | null
          user_agent?: string | null
          ip_address?: string | null
          referrer?: string | null
          landing_page?: string | null
          device_type?: string | null
          browser?: string | null
          country?: string | null
          created_at?: string
          completed_at?: string | null
          status?: 'started' | 'in_progress' | 'completed' | 'abandoned'
        }
      }
      form_responses: {
        Row: {
          id: string
          session_id: string
          industry: string | null
          challenge: string | null
          automation_level: string | null
          facility_size: string | null
          solutions_interest: string[] | null
          timeline: string | null
          full_name: string | null
          organization: string | null
          email: string | null
          phone: string | null
          contact_method: string | null
          notes: string | null
          lead_score: number | null
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          industry?: string | null
          challenge?: string | null
          automation_level?: string | null
          facility_size?: string | null
          solutions_interest?: string[] | null
          timeline?: string | null
          full_name?: string | null
          organization?: string | null
          email?: string | null
          phone?: string | null
          contact_method?: string | null
          notes?: string | null
          lead_score?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          industry?: string | null
          challenge?: string | null
          automation_level?: string | null
          facility_size?: string | null
          solutions_interest?: string[] | null
          timeline?: string | null
          full_name?: string | null
          organization?: string | null
          email?: string | null
          phone?: string | null
          contact_method?: string | null
          notes?: string | null
          lead_score?: number | null
          created_at?: string
        }
      }
      tracking_events: {
        Row: {
          id: string
          session_id: string
          event_type: string
          event_data: Json | null
          step_number: number | null
          timestamp: string
          time_since_start: number | null
        }
        Insert: {
          id?: string
          session_id: string
          event_type: string
          event_data?: Json | null
          step_number?: number | null
          timestamp?: string
          time_since_start?: number | null
        }
        Update: {
          id?: string
          session_id?: string
          event_type?: string
          event_data?: Json | null
          step_number?: number | null
          timestamp?: string
          time_since_start?: number | null
        }
      }
      form_steps: {
        Row: {
          id: string
          session_id: string
          step_number: number
          step_name: string
          entered_at: string
          exited_at: string | null
          time_spent: number | null
          answers: Json | null
        }
        Insert: {
          id?: string
          session_id: string
          step_number: number
          step_name: string
          entered_at?: string
          exited_at?: string | null
          time_spent?: number | null
          answers?: Json | null
        }
        Update: {
          id?: string
          session_id?: string
          step_number?: number
          step_name?: string
          entered_at?: string
          exited_at?: string | null
          time_spent?: number | null
          answers?: Json | null
        }
      }
    }
  }
}
