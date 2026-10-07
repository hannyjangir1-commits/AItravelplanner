import React, { useEffect } from 'react';

interface TermsOfServiceProps {
  onNavigateHome: () => void;
  onNavigatePrivacy: () => void;
}

export const TermsOfService: React.FC<TermsOfServiceProps> = ({
  onNavigateHome,
  onNavigatePrivacy
}) => {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.title = 'User Agreement & Terms of Service — TravelGenie';
    return () => {
      document.title = 'TravelGenie - Destination Planning Intelligence';
    };
  }, []);

  return (
    <div className="legal-page-wrapper">
      {/* Top Navigation Bar */}
      <nav className="legal-nav-bar" aria-label="Legal document navigation">
        <div className="container legal-nav-inner">
          <button
            type="button"
            className="legal-back-btn"
            onClick={onNavigateHome}
            aria-label="Return to TravelGenie planning console"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Back to Planner</span>
          </button>

          <div className="legal-nav-links">
            <button
              type="button"
              className="legal-nav-switch-btn"
              onClick={onNavigatePrivacy}
            >
              Privacy Policy
            </button>
            <span className="legal-nav-divider">/</span>
            <span className="legal-nav-current">User Agreement</span>
          </div>
        </div>
      </nav>

      <main className="container legal-content-container" id="main-content">
        <article className="legal-card">
          {/* Header */}
          <header className="legal-header">
            <div className="legal-badge">Terms of Service &bull; User Agreement</div>
            <h1 className="legal-title">User Agreement &amp; Terms of Service</h1>
            <div className="legal-meta">
              <span><strong>Last updated:</strong> October 2026</span>
              <span className="meta-dot">&bull;</span>
              <span><strong>Project:</strong> TravelGenie (Academic &amp; Student Engineering Project)</span>
            </div>
            <div className="legal-callout-box">
              <p>
                <strong>Academic Notice &amp; Summary:</strong> TravelGenie is an educational, non-commercial engineering project designed to demonstrate generative AI travel planning. It is not an accredited travel agency, booking broker, or commercial operator. All schedules, budget amounts, and recommendations are algorithmic estimates for advisory research only.
              </p>
            </div>
          </header>

          <div className="legal-body">
            {/* 1. Acceptance of Terms */}
            <section className="legal-section">
              <h2>1. Acceptance of Terms</h2>
              <p>
                By visiting, accessing, or using the TravelGenie application (&ldquo;TravelGenie&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), whether as an unauthenticated visitor or as a signed-in user, you acknowledge and agree to be bound by this User Agreement &amp; Terms of Service (&ldquo;Terms&rdquo;).
              </p>
              <p>
                If you do not agree with all provisions of these Terms, you must immediately discontinue use of the application.
              </p>
            </section>

            {/* 2. Description of TravelGenie */}
            <section className="legal-section">
              <h2>2. Description of TravelGenie</h2>
              <p>
                TravelGenie is an AI-assisted web application developed as a student engineering and course project. The application assists users with destination research, sample day-by-day itineraries, estimated budgetary allocations, packing checklists, and local activity suggestions generated through artificial intelligence.
              </p>
              <p>
                TravelGenie is provided purely for informational, research, and educational purposes. It does not provide certified booking, ticketing, travel insurance, or professional tour guiding services.
              </p>
            </section>

            {/* 3. User Accounts & Google Authentication */}
            <section className="legal-section">
              <h2>3. User Accounts and Authentication</h2>
              <p>
                You may access general itinerary planning features without creating an account. To store your generated plans, access itinerary history, and manage your profile place preferences, you may authenticate using Google OAuth 2.0.
              </p>
              <ul>
                <li>You agree to provide authentic and authorized credentials via Google.</li>
                <li>You are solely responsible for maintaining the confidentiality and security of your Google account.</li>
                <li>We do not store or manage your Google password. Authentication is verified through secure application JSON Web Tokens (JWT) stored in HTTP-only cookies.</li>
              </ul>
            </section>

            {/* 4. Acceptable Use */}
            <section className="legal-section">
              <h2>4. Acceptable Use and User Conduct</h2>
              <p>You agree to use TravelGenie only for lawful, personal travel planning purposes. You agree NOT to:</p>
              <ul>
                <li>Submit unlawful, harassing, defamatory, abusive, or obscene prompts or travel notes.</li>
                <li>Attempt to bypass, disable, or circumvent application security, authentication mechanisms, or rate limiters.</li>
                <li>Execute automated scraping, denial-of-service (DoS) attacks, vulnerability scans, or excessive scripted calls to backend endpoints.</li>
                <li>Attempt to access another user&rsquo;s saved itineraries or private profile information.</li>
                <li>Inject malicious code, SQL injection payloads, or cross-site scripting (XSS) scripts into input fields.</li>
                <li>Use TravelGenie to plan activities that violate applicable local, national, or international laws.</li>
              </ul>
            </section>

            {/* 5. User Responsibilities */}
            <section className="legal-section">
              <h2>5. User Responsibilities</h2>
              <p>
                As a user of TravelGenie, you are solely responsible for your own travel decisions, bookings, reservations, and compliance with travel laws:
              </p>
              <ul>
                <li><strong>Independent Verification:</strong> You must independently verify all airline tickets, train schedules, hotel reservations, opening hours, local customs, entry fees, and travel requirements before embarking on any trip.</li>
                <li><strong>Documentation &amp; Visas:</strong> You are responsible for ensuring that you have valid passports, visas, transit permits, travel insurance, and medical certifications required for your destination.</li>
                <li><strong>Personal Safety:</strong> You are solely responsible for assessing current travel advisories, weather warnings, and local security conditions.</li>
              </ul>
            </section>

            {/* 6. AI-Generated Travel Recommendations & Accuracy Disclaimer */}
            <section className="legal-section">
              <h2>6. AI-Generated Content &amp; Accuracy Disclaimer</h2>
              <p>
                Itineraries generated by TravelGenie are produced using artificial intelligence models (Google Gemini) and heuristics. While we aim to provide helpful and creative recommendations, artificial intelligence models have inherent technical limitations:
              </p>
              <ul>
                <li><strong>Possibility of Errors (&ldquo;Hallucinations&rdquo;):</strong> AI models may generate inaccurate, outdated, fictional, or geometrically impractical suggestions.</li>
                <li><strong>Operating Hours &amp; Closures:</strong> Attraction opening hours, museum days, restaurant operations, and route feasibility may change without notice.</li>
                <li><strong>Advisory Nature:</strong> All recommendations, timelines, and logistical suggestions are purely advisory estimates. TravelGenie makes no representations or warranties regarding the completeness, accuracy, or suitability of any generated plan.</li>
              </ul>
            </section>

            {/* 7. Travel, Transportation, Accommodation and Activity Disclaimer */}
            <section className="legal-section">
              <h2>7. Travel, Transportation, and Accommodation Disclaimer</h2>
              <p>
                <strong>TravelGenie is NOT a travel agency, tour operator, carrier, hotelier, or booking agent.</strong>
              </p>
              <ul>
                <li>We do not book, sell, endorse, or verify any flights, trains, rental cars, hotels, homestays, restaurants, or tour guides mentioned in itineraries.</li>
                <li>Any mention of specific brands, hotels, airlines, attractions, or services does not constitute an endorsement, sponsorship, or affiliation with TravelGenie.</li>
                <li>We have no control over the conduct, safety, quality, or legality of third-party hospitality or transportation providers.</li>
              </ul>
            </section>

            {/* 8. No Guarantee of Availability or Pricing */}
            <section className="legal-section">
              <h2>8. No Guarantee of Availability or Pricing</h2>
              <p>
                All budget calculations, hotel price tiers, daily expense breakdowns, food estimates, and currency amounts displayed in Indian Rupees (INR) or other currencies are rough computational estimates:
              </p>
              <ul>
                <li>Actual prices fluctuate frequently due to inflation, demand, dynamic pricing, seasonal surges, fuel charges, and local taxes.</li>
                <li>TravelGenie does not guarantee that any suggested activity, accommodation, or transportation will be available at the estimated cost or available at all.</li>
              </ul>
            </section>

            {/* 9. Third-Party Services */}
            <section className="legal-section">
              <h2>9. Third-Party Services and External Links</h2>
              <p>
                The application relies on third-party cloud platforms, notably Google OAuth 2.0 and the Google Gemini API. TravelGenie is not responsible for the performance, terms, policies, or downtime of third-party platforms.
              </p>
            </section>

            {/* 10. Intellectual Property */}
            <section className="legal-section">
              <h2>10. Intellectual Property</h2>
              <p>
                The TravelGenie source code, application interface design, stylesheets, and branding are the intellectual property of the student developers.
              </p>
              <p>
                You are granted a personal, revocable, non-exclusive, non-transferable license to access and use the application for non-commercial personal planning. You may download, print, or export generated itineraries for your own personal travel use.
              </p>
            </section>

            {/* 11. User-Generated Information */}
            <section className="legal-section">
              <h2>11. User-Generated Inputs and Prompts</h2>
              <p>
                You retain ownership of any destination parameters, notes, or prompts that you enter into the application. By submitting planning inputs, you grant TravelGenie the non-exclusive license to process and transmit those inputs to our generative AI service solely to generate your travel plan and display your itinerary history.
              </p>
            </section>

            {/* 12. Account Termination and Suspension */}
            <section className="legal-section">
              <h2>12. Account Termination and Service Availability</h2>
              <p>
                Because TravelGenie is an academic demonstration project, we reserve the right to modify, suspend, or terminate the application, specific API endpoints, or user accounts at any time, with or without prior notice, for reasons including academic term completion, server maintenance, or abuse prevention.
              </p>
              <p>
                You may discontinue use at any time by logging out or requesting account deletion.
              </p>
            </section>

            {/* 13. Disclaimer of Warranties */}
            <section className="legal-section">
              <h2>13. Disclaimer of Warranties</h2>
              <p>
                TRAVELGENIE IS PROVIDED STRICTLY ON AN <strong>&ldquo;AS IS&rdquo;</strong> AND <strong>&ldquo;AS AVAILABLE&rdquo;</strong> BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, ACCURACY, AND NON-INFRINGEMENT.
              </p>
              <p>
                WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, ACCURATE, OR COMPLETELY FREE OF HARMFUL COMPONENTS.
              </p>
            </section>

            {/* 14. Limitation of Liability */}
            <section className="legal-section">
              <h2>14. Limitation of Liability</h2>
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE STUDENT DEVELOPERS, CONTRIBUTORS, AND ASSOCIATED EDUCATIONAL INSTITUTIONS SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR IN CONNECTION WITH:
              </p>
              <ul>
                <li>Your access to, use of, or inability to access or use TravelGenie.</li>
                <li>Any reliance placed on AI-generated travel plans, itineraries, recommendations, or budget calculations.</li>
                <li>Any travel disruptions, missed flights, cancelled reservations, accidents, personal injuries, financial losses, or itinerary changes encountered during your travels.</li>
                <li>Any errors, omissions, inaccuracies, or hallucinations in generated content.</li>
                <li>Unauthorized access to or alteration of your transmissions or data.</li>
              </ul>
            </section>

            {/* 15. Changes to Terms */}
            <section className="legal-section">
              <h2>15. Changes to this User Agreement</h2>
              <p>
                We may revise this User Agreement from time to time. When updates are published, the revised document will be posted on this page with an updated &ldquo;Last updated&rdquo; date. Continued access or use of TravelGenie following such updates signifies your acceptance of the revised Terms.
              </p>
            </section>

            {/* 16. Governing Provisions */}
            <section className="legal-section">
              <h2>16. General &amp; Academic Provisions</h2>
              <p>
                These Terms constitute the entire agreement between you and TravelGenie regarding your use of the application. If any provision of these Terms is found to be invalid or unenforceable, the remaining provisions will continue in full force and effect.
              </p>
            </section>

            {/* 17. Contact Information */}
            <section className="legal-section">
              <h2>17. Contact Information</h2>
              <p>
                For inquiries, feedback, or concerns regarding these Terms of Service, please reach out to the student project maintainers at:
              </p>
              <div className="contact-box">
                <p><strong>Project:</strong> TravelGenie &mdash; Destination Planning Intelligence</p>
                <p><strong>Type:</strong> Academic Student Engineering Project</p>
                <p><strong>Contact Email:</strong> <a href="mailto:hannyjangir1@gmail.com">hannyjangir1@gmail.com</a></p>
              </div>
            </section>
          </div>

          {/* Footer inside document */}
          <footer className="legal-footer-nav">
            <button
              type="button"
              className="legal-btn-primary"
              onClick={onNavigateHome}
            >
              Return to Travel Planner
            </button>
            <button
              type="button"
              className="legal-btn-secondary"
              onClick={onNavigatePrivacy}
            >
              Read Privacy Policy &rarr;
            </button>
          </footer>
        </article>
      </main>
    </div>
  );
};
