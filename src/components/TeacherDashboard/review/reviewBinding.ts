/**
 * The editing/action surface shared by every review card. State lives in the
 * modal (so the unsaved-changes guard can see pending edits across navigation);
 * cards stay presentational and controlled.
 */
export type ReviewActionName = "approve" | "mark-reviewed" | "release-feedback" | "grade";

export interface ActionState {
  loading: boolean;
  success: boolean;
  error: string | null;
}

export interface ReviewBinding {
  overrideScores: { [id: string]: number };
  overrideNotes: { [id: string]: string };
  editedFeedbacks: { [id: string]: string };
  savingState: { [id: string]: boolean };
  saveSuccess: { [id: string]: boolean };
  actionStates: { [id: string]: ActionState };
  setOverrideScore: (id: string, value: number) => void;
  setOverrideNote: (id: string, value: string) => void;
  setEditedFeedback: (id: string, value: string) => void;
  saveOverride: (responseId: string, maxPoints: number) => void;
  reviewAction: (action: ReviewActionName, responseId: string) => void;
  canReviewAction: boolean;
}
