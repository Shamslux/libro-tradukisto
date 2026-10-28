export interface TourStep { title: string; description: string; selector: string; fallbackSelector?: string; }

export const tourSteps: TourStep[] = [
  { title: 'tourInterface', description: 'tourInterfaceDesc', selector: '.app-top-header' },
  { title: 'tourImport', description: 'tourImportDesc', selector: '.app-sidebar-controls .sidebar-section-card:nth-of-type(3)' },
  { title: 'tourLanguage', description: 'tourLanguageDesc', selector: '.app-sidebar-controls .sidebar-section-card:nth-of-type(4) .select-lang-input' },
  { title: 'tourProvider', description: 'tourProviderDesc', selector: '.radio-tile' },
  { title: 'tourChapters', description: 'tourChaptersDesc', selector: '.chapter-tree-wrapper', fallbackSelector: '.app-editor-viewport' },
  { title: 'tourTranslate', description: 'tourTranslateDesc', selector: '.sidebar-action-footer .btn-success-runner', fallbackSelector: '.app-sidebar-controls' },
  { title: 'tourExport', description: 'tourExportDesc', selector: '.sidebar-action-footer .btn-success-runner:last-child', fallbackSelector: '.app-editor-viewport' },
];
