import React, { useEffect } from 'react';

interface PrivacyPolicyProps {
  onNavigateHome: () => void;
  onNavigateTerms: () => void;
}

export const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({
  onNavigateHome,
  onNavigateTerms
}) => {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.title = 'Privacy Policy — TravelGenie';
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
            <span className="legal-nav-current">Privacy Policy</span>
            <span className="legal-nav-divider">/</span>
            <button
              type="button"
              className="legal-nav-switch-btn"
              onClick={onNavigateTerms}
            >
              User Agreement
            </button>
          </div>
        </div>
      </nav>

      <main className="container legal-content-container" id="main-content">
        <article className="legal-card">
          {/* Header */}
          <header className="legal-header">
            <div className="legal-badge">Public Legal Notice</div>
            <h1 className="legal-title">Privacy Policy</h1>
            <div className="legal-meta">
              <span><strong>Last updated:</strong> October 2026</span>
              <span className="meta-dot">&bull;</span>
              <span><strong>Project:</strong> TravelGenie (Academic &amp; Student Engineering Project)</span>
            </div>
            <div className="legal-callout-box">
              <p>
                <strong>Academic Notice:</strong> TravelGenie is developed as a student/college engineering demonstration project. It is not operated by a commercial corporation. This Privacy Policy transparently explains how your personal information, Google account details, and travel preferences are collected, processed, and stored when you access our service.
              </p>
            </div>
          </header>

          <div className="legal-body">
            {/* 1. Introduction */}
            <section className="legal-section">
              <h2>1. Introduction</h2>
              <p>
                Welcome to TravelGenie (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;, or &ldquo;the application&rdquo;). We respect your privacy and are committed to handling your data transparently. This Privacy Policy applies to the TravelGenie web application, including its itinerary generation engine, profile management, and saved itinerary history features.
              </p>
              <p>
                By accessing or using TravelGenie, you acknowledge that you have read and understood the practices described in this Privacy Policy. If you do not agree with these practices, please refrain from using the application.
              </p>
            </section>

            {/* 2. Information Collected */}
            <section className="legal-section">
              <h2>2. Information We Collect</h2>
              <p>
                We only collect information necessary to authenticate your session, generate customized travel plans, and enable you to review your past itineraries.
              </p>

              <h3>A. Google Account Information (OAuth 2.0)</h3>
              <p>
                When you choose to sign in using Google, we initiate a standard OAuth 2.0 authorization request. Through this process, Google provides us with basic profile details:
              </p>
              <ul>
                <li><strong>Google User ID:</strong> A unique numerical identifier provided by Google to distinguish your account.</li>
                <li><strong>Full Name:</strong> Your display name associated with your Google account.</li>
                <li><strong>Email Address:</strong> Your primary Google account email address.</li>
                <li><strong>Profile Picture URL:</strong> A link to your public Google account avatar image.</li>
              </ul>
              <p>
                <em>We do NOT request or receive your Google password, contacts, emails, Google Drive documents, payment methods, or any other sensitive account information.</em>
              </p>

              <h3>B. Profile Information</h3>
              <p>
                Authenticated users may optionally choose to update their display name and set their preferred place/city within the application profile menu.
              </p>

              <h3>C. Travel Preferences and Planning Inputs</h3>
              <p>
                When you generate or modify a travel plan, we collect the parameters you provide in the planning form:
              </p>
              <ul>
                <li>Destination name or region</li>
                <li>Trip duration (number of days)</li>
                <li>Estimated budget in Indian Rupees (INR)</li>
                <li>Number of travelers</li>
                <li>Selected interests (e.g., Adventure, Heritage, Culinary, Wellness)</li>
                <li>Accommodation preference (e.g., Budget, Mid-range, Luxury)</li>
                <li>Pace and activity level</li>
                <li>Optional free-text notes or special requests</li>
              </ul>
              <p>
                <em>Please do not include passwords, payment card numbers, passport credentials, or sensitive personal medical information in your travel planning notes.</em>
              </p>

              <h3>D. Generated Itinerary Data</h3>
              <p>
                When an itinerary is generated, the resulting structured schedule (including executive summary, daily timelines, packing checklists, logistics recommendations, and cost estimates) is associated with your account if you are signed in.
              </p>
            </section>

            {/* 3. How Information is Used */}
            <section className="legal-section">
              <h2>3. How Information is Used</h2>
              <p>We use the collected information solely for the following technical and functional purposes:</p>
              <ul>
                <li><strong>Authentication &amp; Session Management:</strong> To verify your identity, maintain your logged-in state across page navigations, and protect account ownership.</li>
                <li><strong>Itinerary Generation:</strong> To supply your destination preferences, budget, and travel interests to the underlying AI model (Google Gemini) to craft customized travel plans.</li>
                <li><strong>Itinerary History:</strong> To save generated plans to our database so that authenticated users can revisit and review their saved itineraries under the &ldquo;Previous Itineraries&rdquo; section.</li>
                <li><strong>Profile Personalization:</strong> To display your avatar, name, and home city in the header profile popover.</li>
                <li><strong>Application Stability:</strong> To detect errors, monitor API rate limits, and maintain system security.</li>
              </ul>
              <p>
                We do not sell, rent, monetize, or use your personal information for marketing campaigns or commercial advertising.
              </p>
            </section>

            {/* 4. How Information is Stored */}
            <section className="legal-section">
              <h2>4. How Information is Stored</h2>
              <h3>A. PostgreSQL Database</h3>
              <p>
                For authenticated users, account profile details and saved itineraries are securely stored in a relational PostgreSQL database. Database queries use parameterized SQL statements to safeguard against SQL injection and prevent unauthorized data modification.
              </p>

              <h3>B. Browser Session Storage (Unauthenticated &amp; Temporary State)</h3>
              <p>
                If you use TravelGenie as an unauthenticated guest, your generated travel plan is held temporarily in your browser&rsquo;s <code>sessionStorage</code> and React component memory. It is NOT saved to the PostgreSQL database. Closing your browser tab or clicking &ldquo;New Itinerary&rdquo; clears this temporary data.
              </p>
            </section>

            {/* 5. Cookies and Session Security */}
            <section className="legal-section">
              <h2>5. Cookies and Authentication Security</h2>
              <p>TravelGenie uses minimal, functional HTTP cookies for session security:</p>
              <ul>
                <li>
                  <code>travelgenie_auth</code>: An HTTP-only, secure cookie containing an encrypted application JSON Web Token (JWT). This cookie verifies your authenticated status on backend API calls without exposing tokens to client-side JavaScript.
                </li>
                <li>
                  <code>oauth_state</code>: A short-lived, single-use cookie used strictly during Google OAuth sign-in to protect against Cross-Site Request Forgery (CSRF).
                </li>
              </ul>
              <p>
                We do NOT use tracking cookies, third-party advertising pixels, or cross-site fingerprinting technologies.
              </p>
            </section>

            {/* 6. AI Processing & Third-Party Services */}
            <section className="legal-section">
              <h2>6. AI Processing &amp; Third-Party Services</h2>
              <p>To deliver travel planning intelligence, TravelGenie interacts with trusted third-party cloud services:</p>
              <ul>
                <li>
                  <strong>Google Gemini API:</strong> When generating or modifying an itinerary, travel parameters (destination, duration, budget, interests, notes) are sent to Google&rsquo;s Gemini generative AI models. Google processes these requests to generate itinerary recommendations. Prompt data is submitted solely for plan generation purposes.
                </li>
                <li>
                  <strong>Google OAuth 2.0:</strong> Used for identity verification and secure sign-in.
                </li>
                <li>
                  <strong>Cloud Hosting Infrastructure:</strong> TravelGenie runs on standard cloud application and database hosting infrastructure (e.g., Render / managed PostgreSQL).
                </li>
              </ul>
            </section>

            {/* 7. Data Sharing */}
            <section className="legal-section">
              <h2>7. Data Sharing and Disclosure</h2>
              <p>
                We do not share, sell, or disclose your personal data to any external parties, data brokers, or marketing partners. We only transmit data to third parties under the following limited conditions:
              </p>
              <ul>
                <li>To third-party infrastructure providers directly required to run the service (Google Gemini API for planning logic, Google OAuth for authentication, and cloud database hosting).</li>
                <li>If required to comply with a valid legal obligation, court order, or official governmental request.</li>
              </ul>
            </section>

            {/* 8. Data Retention & Account Deletion */}
            <section className="legal-section">
              <h2>8. Data Retention and Account Considerations</h2>
              <p>
                Saved travel itineraries and user profiles are retained in our database while the academic project is operational, enabling you to access your itinerary history whenever you log in.
              </p>
              <p>
                When you click <strong>Log Out</strong>, your session cookie is immediately invalidated and cleared from your browser, terminating your active session.
              </p>
              <p>
                If you would like your account profile and associated itineraries deleted from our database, please submit a deletion request to our contact email indicated below.
              </p>
            </section>

            {/* 9. Security */}
            <section className="legal-section">
              <h2>9. Security Measures</h2>
              <p>
                We employ standard web security practices to protect your information, including HTTP-only cookie storage, parameterized database queries, strict foreign-key ownership verification, Helmet security headers, CORS origin protections, and API rate limiting.
              </p>
              <p>
                <em>Disclaimer:</em> While we implement reasonable safeguards, no Internet application or electronic database is completely invulnerable. As an academic engineering project, TravelGenie is provided without commercial enterprise guarantees.
              </p>
            </section>

            {/* 10. User Rights */}
            <section className="legal-section">
              <h2>10. Your Choices and Rights</h2>
              <p>You have control over how you interact with TravelGenie:</p>
              <ul>
                <li><strong>Anonymous Use:</strong> You can generate travel plans as a guest without logging in. Guest plans are never stored in our PostgreSQL database.</li>
                <li><strong>Profile Access &amp; Editing:</strong> Authenticated users can view and update their profile name and place at any time via the profile popover.</li>
                <li><strong>History Access:</strong> Authenticated users can access their previous itineraries under the Previous Itineraries section.</li>
                <li><strong>Account Deletion:</strong> You may request removal of your account and saved itineraries by contacting the project maintainer.</li>
              </ul>
            </section>

            {/* 11. Children's Privacy */}
            <section className="legal-section">
              <h2>11. Children&rsquo;s Privacy</h2>
              <p>
                TravelGenie is not directed toward individuals under the age of 13 (or under the age of digital consent in your jurisdiction). We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact us so we can promptly delete the data.
              </p>
            </section>

            {/* 12. Changes to this Policy */}
            <section className="legal-section">
              <h2>12. Changes to this Privacy Policy</h2>
              <p>
                We may revise this Privacy Policy from time to time as features evolve. When changes are made, we will update the &ldquo;Last updated&rdquo; date at the top of this document. We encourage users to review this page periodically.
              </p>
            </section>

            {/* 13. Contact Information */}
            <section className="legal-section">
              <h2>13. Contact Information</h2>
              <p>
                If you have any questions, feedback, or data deletion requests regarding this Privacy Policy or your use of TravelGenie, please contact the student maintainers at:
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
              onClick={onNavigateTerms}
            >
              Read User Agreement &rarr;
            </button>
          </footer>
        </article>
      </main>
    </div>
  );
};
