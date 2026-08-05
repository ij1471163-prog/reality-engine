import { StackScreenProps } from '@react-navigation/stack';

export type RootStackParamList = {
  Home:           undefined;
  FileUpload:     undefined;                            // رفع ملف فقط
  AnalysisPreview:undefined;                            // تقرير ما قبل التعديل
  Scanner:        { mode: 'security' | 'stubs' | 'full' };
  Results:        { mode: 'security' | 'stubs' | 'full' };
  Approval:       { mode: string };
  History:        undefined;
};

export type HomeScreenProps           = StackScreenProps<RootStackParamList, 'Home'>;
export type FileUploadScreenProps     = StackScreenProps<RootStackParamList, 'FileUpload'>;
export type AnalysisPreviewScreenProps= StackScreenProps<RootStackParamList, 'AnalysisPreview'>;
export type ScannerScreenProps        = StackScreenProps<RootStackParamList, 'Scanner'>;
export type ResultsScreenProps        = StackScreenProps<RootStackParamList, 'Results'>;
export type ApprovalScreenProps       = StackScreenProps<RootStackParamList, 'Approval'>;
export type HistoryScreenProps        = StackScreenProps<RootStackParamList, 'History'>;
