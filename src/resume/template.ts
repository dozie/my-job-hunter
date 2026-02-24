import type { ResumeData } from './builder.js';

export function buildHtmlTemplate(data: ResumeData): string {
  const { basics, skills, work, education } = data;

  const skillsHtml = skills.map(s => `<span class="skill">${escapeHtml(s)}</span>`).join('\n            ');

  const workHtml = work
    .map(
      (job) => `
          <div class="job">
            <div class="job-header">
              <strong>${escapeHtml(job.position)},</strong> ${escapeHtml(job.startDate)} to ${escapeHtml(job.endDate)}
            </div>
            <div class="job-company">${escapeHtml(job.company)} - ${escapeHtml(job.location)}</div>
            <ul>
              ${job.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('\n              ')}
            </ul>
          </div>`,
    )
    .join('\n');

  const educationHtml = education
    .map(
      (edu) => `
          <div class="education-item">
            <strong>${escapeHtml(edu.studyType)}: ${escapeHtml(edu.area)},</strong> ${escapeHtml(edu.date)}.
            <br/>${escapeHtml(edu.institution)} - ${escapeHtml(edu.location)}.
          </div>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(basics.name)} - Resume</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; line-height: 1.5; }

    .header {
      background: #5a6977;
      color: white;
      text-align: center;
      padding: 30px 20px;
    }
    .header h1 { font-size: 28px; letter-spacing: 3px; font-weight: 300; }
    .header h2 { font-size: 14px; letter-spacing: 2px; font-weight: 300; margin-top: 5px; }

    .container { display: flex; }

    .sidebar {
      width: 30%;
      background: #f0f0f0;
      padding: 25px 20px;
      min-height: 100vh;
    }
    .sidebar h3 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
      color: #333;
      border-bottom: 1px solid #ccc;
      padding-bottom: 5px;
    }
    .sidebar .section { margin-bottom: 25px; }
    .sidebar p { font-size: 12px; margin-bottom: 4px; }
    .sidebar a { color: #333; text-decoration: none; }
    .sidebar a:hover { text-decoration: underline; }

    .skills { display: flex; flex-wrap: wrap; gap: 5px; }
    .skill {
      font-size: 11px;
      background: #ddd;
      padding: 2px 8px;
      border-radius: 3px;
    }

    .main {
      width: 70%;
      padding: 25px 30px;
    }
    .main h3 {
      font-size: 15px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 15px;
      color: #333;
      border-bottom: 2px solid #5a6977;
      padding-bottom: 5px;
    }
    .main .section { margin-bottom: 25px; }

    .summary-text { font-size: 13px; color: #555; }

    .job { margin-bottom: 18px; }
    .job-header { font-size: 13px; }
    .job-company { font-size: 12px; color: #666; font-style: italic; margin-bottom: 6px; }
    .job ul { list-style: disc; margin-left: 18px; }
    .job li { font-size: 12px; margin-bottom: 4px; }

    .education-item { font-size: 13px; margin-bottom: 8px; }

    @media print {
      body { font-size: 11px; }
      .sidebar { background: #f0f0f0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .header { background: #5a6977 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(basics.name).toUpperCase()}</h1>
    <h2>${escapeHtml(basics.headline).toUpperCase()}</h2>
  </div>
  <div class="container">
    <div class="sidebar">
      <div class="section">
        <h3>Contact</h3>
        <p>Address : ${escapeHtml(basics.location)}</p>
        <p>Phone : ${escapeHtml(basics.phone)}</p>
        <p>Email : ${escapeHtml(basics.email)}</p>
      </div>
      ${basics.url?.linkedin ? `
      <div class="section">
        <h3>Websites, Portfolios, Profiles</h3>
        <p><a href="https://${escapeHtml(basics.url.linkedin)}">${escapeHtml(basics.url.linkedin)}</a></p>
      </div>` : ''}
      <div class="section">
        <h3>Skills</h3>
        <div class="skills">
          ${skillsHtml}
        </div>
      </div>
    </div>
    <div class="main">
      <div class="section">
        <h3>Summary</h3>
        <p class="summary-text">${escapeHtml(basics.summary)}</p>
      </div>
      <div class="section">
        <h3>Work History</h3>
        ${workHtml}
      </div>
      <div class="section">
        <h3>Education</h3>
        ${educationHtml}
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
