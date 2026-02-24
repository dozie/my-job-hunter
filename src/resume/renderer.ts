import { buildHtmlTemplate } from './template.js';
import type { ResumeData } from './builder.js';

export function renderResumeHtml(data: ResumeData): string {
  return buildHtmlTemplate(data);
}
