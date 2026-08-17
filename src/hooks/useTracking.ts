import { useEffect, useCallback } from 'react';
import {
  trackEvent,
  trackStepEntry,
  trackStepExit,
  trackVisibilityChanges,
  getCurrentSessionId,
} from '../lib/tracking';

export function useTracking(currentStep?: number) {
  const sessionId = getCurrentSessionId();

  // Track generic events
  const track = useCallback(
    (eventType: string, eventData?: Record<string, any>) => {
      if (!sessionId) return;
      trackEvent(sessionId, eventType, eventData, currentStep);
    },
    [sessionId, currentStep]
  );

  // Track button clicks
  const trackClick = useCallback(
    (buttonName: string, additionalData?: Record<string, any>) => {
      track('button_clicked', {
        button: buttonName,
        ...additionalData,
      });
    },
    [track]
  );

  // Track option selection
  const trackSelection = useCallback(
    (fieldName: string, value: any) => {
      track('option_selected', {
        field: fieldName,
        value: value,
      });
    },
    [track]
  );

  // Track step entry
  const trackEnterStep = useCallback(
    (stepNumber: number, stepName: string, answers?: Record<string, any>) => {
      if (!sessionId) return;
      trackStepEntry(sessionId, stepNumber, stepName, answers);
      track('step_entered', { step: stepNumber, name: stepName });
    },
    [sessionId, track]
  );

  // Track step exit
  const trackExitStep = useCallback(
    (stepNumber: number, answers?: Record<string, any>) => {
      if (!sessionId) return;
      trackStepExit(sessionId, stepNumber, answers);
      track('step_exited', { step: stepNumber });
    },
    [sessionId, track]
  );

  // Set up visibility tracking on mount
  useEffect(() => {
    if (sessionId) {
      trackVisibilityChanges(sessionId);
    }
  }, [sessionId]);

  return {
    track,
    trackClick,
    trackSelection,
    trackEnterStep,
    trackExitStep,
    sessionId,
  };
}
