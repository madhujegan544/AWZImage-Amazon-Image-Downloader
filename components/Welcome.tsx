/**
 * PIXORA - Welcome Screen
 * First-time user onboarding
 */

import './App.css';

interface WelcomeProps {
    onGetStarted: () => void;
}

const COLORS = {
    primary: '#2563EB',
    primarySoft: '#EFF6FF',
    primaryGlow: 'rgba(37, 99, 235, 0.15)',
    surface: '#FFFFFF',
    background: '#F8FAFC',
    text: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    border: '#E2E8F0',
    shadowPrimary: '0 4px 14px rgba(37, 99, 235, 0.25)',
    shadowMd: '0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -1px rgba(0, 0, 0, 0.04)',
};

function Welcome({ onGetStarted }: WelcomeProps) {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
            background: COLORS.background,
            fontFamily: "'Google Sans Flex', 'Google Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
            padding: '32px 24px',
            textAlign: 'center'
        }}>
            {/* Logo */}
            <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '24px',
                background: `linear-gradient(135deg, ${COLORS.primary} 0%, #3B82F6 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: COLORS.shadowPrimary,
                marginBottom: '28px',
                animation: 'fadeInScale 0.5s ease-out'
            }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
            </div>

            {/* Branding */}
            <h1 style={{
                fontSize: '28px',
                fontWeight: 700,
                color: COLORS.text,
                marginBottom: '8px',
                letterSpacing: '-0.5px',
                animation: 'fadeInUp 0.5s ease-out 0.1s backwards'
            }}>
                Pixora
            </h1>

            <p style={{
                fontSize: '14px',
                color: COLORS.textMuted,
                marginBottom: '32px',
                fontWeight: 500,
                animation: 'fadeInUp 0.5s ease-out 0.2s backwards'
            }}>
                Amazon Media, Instantly.
            </p>

            {/* Features */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                width: '100%',
                maxWidth: '280px',
                marginBottom: '40px',
                animation: 'fadeInUp 0.5s ease-out 0.3s backwards'
            }}>
                {[
                    { icon: '📷', text: 'Download product images' },
                    { icon: '🎬', text: 'Save product videos' },
                    { icon: '⭐', text: 'Grab review media' },
                    { icon: '📦', text: 'One-click ZIP download' }
                ].map((feature, index) => (
                    <div
                        key={index}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '12px 16px',
                            background: COLORS.surface,
                            borderRadius: '12px',
                            boxShadow: COLORS.shadowMd,
                            textAlign: 'left'
                        }}
                    >
                        <span style={{ fontSize: '18px' }}>{feature.icon}</span>
                        <span style={{
                            fontSize: '13px',
                            fontWeight: 500,
                            color: COLORS.text
                        }}>
                            {feature.text}
                        </span>
                    </div>
                ))}
            </div>

            {/* CTA Button */}
            <button
                onClick={onGetStarted}
                style={{
                    width: '100%',
                    maxWidth: '280px',
                    padding: '16px 24px',
                    background: COLORS.primary,
                    border: 'none',
                    borderRadius: '14px',
                    fontSize: '15px',
                    fontWeight: 600,
                    color: '#fff',
                    cursor: 'pointer',
                    boxShadow: COLORS.shadowPrimary,
                    transition: 'all 0.2s ease',
                    animation: 'fadeInUp 0.5s ease-out 0.4s backwards'
                }}
            >
                Get Started
            </button>

            {/* Footer Note */}
            <p style={{
                marginTop: '24px',
                fontSize: '11px',
                color: COLORS.textMuted,
                animation: 'fadeInUp 0.5s ease-out 0.5s backwards'
            }}>
                Works on any Amazon product page
            </p>

            {/* Animations */}
            <style>{`
                @keyframes fadeInScale {
                    from {
                        opacity: 0;
                        transform: scale(0.9);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1);
                    }
                }
                
                @keyframes fadeInUp {
                    from {
                        opacity: 0;
                        transform: translateY(12px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            `}</style>
        </div>
    );
}

export default Welcome;
