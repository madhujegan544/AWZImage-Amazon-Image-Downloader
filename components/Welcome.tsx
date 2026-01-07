const COLORS = {
    bg: '#F6F7FB',
    bgSecondary: '#EFF1F7',
    bgHover: '#E9ECF4',
    bgGradient: 'linear-gradient(180deg, #FFFFFF 0%, #F6F7FB 100%)',
    bgCard: '#FFFFFF',
    border: '#E2E4F2',
    borderLight: '#EEF0F8',
    text: '#2E2F38',
    textSecondary: '#6B6F85',
    textMuted: '#9AA0B5',
    accent: '#7B7FF2',
    accentLight: '#E8E9FF',
    accentDark: '#666AD1',
    white: '#FFFFFF',
    shadowSm: '0 2px 4px rgba(123, 127, 242, 0.04), 0 1px 2px rgba(123, 127, 242, 0.02)',
    shadowMd: '0 4px 12px rgba(123, 127, 242, 0.06), 0 2px 4px rgba(123, 127, 242, 0.03)',
    shadowAccent: '0 4px 16px rgba(123, 127, 242, 0.20), 0 2px 4px rgba(123, 127, 242, 0.10)'
};

interface WelcomeProps {
    onGetStarted: () => void;
}

function Welcome({ onGetStarted }: WelcomeProps) {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            background: COLORS.bg,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            color: COLORS.text,
            overflow: 'hidden'
        }}>
            {/* Main Content */}
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 32px',
                textAlign: 'center'
            }}>
                {/* Logo */}
                <div style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '20px',
                    background: 'linear-gradient(135deg, #666AD1 0%, #7B7FF2 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 8px 32px rgba(123, 127, 242, 0.25)',
                    marginBottom: '28px'
                }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                    </svg>
                </div>

                {/* Title */}
                <h1 style={{
                    margin: 0,
                    fontSize: '28px',
                    fontWeight: 800,
                    letterSpacing: '-0.5px',
                    color: COLORS.text,
                    marginBottom: '8px'
                }}>
                    AMZ<span style={{
                        background: 'linear-gradient(135deg, #7B7FF2 0%, #8E92F7 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        marginLeft: '1px'
                    }}>IMAGE</span>
                </h1>
                <p style={{
                    margin: 0,
                    fontSize: '14px',
                    color: COLORS.textMuted,
                    fontWeight: 500,
                    marginBottom: '32px'
                }}>
                    Amazon Image Downloader
                </p>

                {/* Features */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    marginBottom: '40px',
                    width: '100%',
                    maxWidth: '280px'
                }}>
                    {[
                        { icon: '📷', title: 'Product Images', desc: 'Download high-quality product photos' },
                        { icon: '⭐', title: 'Review Images', desc: 'Capture customer review images' },
                        { icon: '🎬', title: 'Product Videos', desc: 'Save promotional videos' }
                    ].map((feature, i) => (
                        <div key={i} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '14px',
                            padding: '14px 16px',
                            background: COLORS.white,
                            borderRadius: '12px',
                            border: `1px solid ${COLORS.border}`,
                            textAlign: 'left',
                            boxShadow: COLORS.shadowSm
                        }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '10px',
                                background: COLORS.accentLight,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '18px',
                                flexShrink: 0
                            }}>
                                {feature.icon}
                            </div>
                            <div>
                                <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: COLORS.text }}>
                                    {feature.title}
                                </p>
                                <p style={{ margin: '2px 0 0', fontSize: '12px', color: COLORS.textMuted }}>
                                    {feature.desc}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* CTA Button */}
                <button
                    onClick={onGetStarted}
                    style={{
                        width: '100%',
                        maxWidth: '280px',
                        padding: '16px 32px',
                        background: `linear-gradient(135deg, ${COLORS.accentDark} 0%, ${COLORS.accent} 100%)`,
                        border: 'none',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: '15px',
                        color: COLORS.white,
                        boxShadow: COLORS.shadowAccent,
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = COLORS.shadowAccent;
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = COLORS.shadowAccent;
                    }}
                >
                    Get Started
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                    </svg>
                </button>
            </div>

            {/* Footer */}
            <div style={{
                padding: '20px',
                textAlign: 'center',
                borderTop: `1px solid ${COLORS.border}`
            }}>
                <p style={{
                    margin: 0,
                    fontSize: '11px',
                    color: COLORS.textMuted
                }}>
                    Works on Amazon product and listing pages
                </p>
            </div>
        </div>
    );
}

export default Welcome;
