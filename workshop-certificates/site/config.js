/*
 * Ivy Workshop Certificates - site settings
 * Edit this file once after deploying the Apps Script web app.
 */
window.IVY_CONFIG = {
  // Paste the Apps Script web app URL ending in /exec.
  // Leave empty to run the site in DEMO MODE (data stays in this browser only).
  API_URL: '',

  // Public address of this site, without a trailing slash, e.g. 'https://certificates.ivyproschool.com'.
  // Leave empty to use whatever address the page is opened from.
  SITE_URL: '',

  // Where "Explore programs" buttons send people. UTM tags are added automatically.
  IVY_WEBSITE: 'https://ivyproschool.com',
  ENTERPRISE_URL: 'https://ivyproschool.com',

  // Optional: Ivy's LinkedIn company page numeric ID. When set, "Add to profile" links the
  // certification to the Ivy page (with logo). Find it in the URL of the page admin view,
  // e.g. linkedin.com/company/1234567/admin -> '1234567'.
  LINKEDIN_ORG_ID: '',
  LINKEDIN_ORG_NAME: 'Ivy Professional School',

  // Sign-off printed on certificates.
  SIGNATORY_NAME: 'Prateek Agrawal',
  SIGNATORY_TITLE: 'Founder, Ivy Professional School',
  // Optional transparent PNG of the signature, e.g. 'assets/signature.png'. Leave empty for a typed sign-off.
  SIGNATURE_IMAGE: '',

  // Approved figures only. Do not add numbers that are not on the approved list.
  PROOF_POINTS: [
    { value: '18+', label: 'years in AI and data training' },
    { value: '37,500+', label: 'alumni' },
    { value: '4.8/5', label: 'Google rating, 2,250+ reviews' },
    { value: 'MeitY', label: 'Recognized' }
  ],

  HASHTAGS: '#AI #GenerativeAI #Upskilling #IvyProfessionalSchool'
};
