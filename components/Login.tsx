import { useState } from 'react';

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
    success: '#6BCB77',
    error: '#FF6B6B',
    white: '#FFFFFF',
    shadowSm: '0 2px 4px rgba(123, 127, 242, 0.04), 0 1px 2px rgba(123, 127, 242, 0.02)',
    shadowMd: '0 4px 12px rgba(123, 127, 242, 0.06), 0 2px 4px rgba(123, 127, 242, 0.03)',
    shadowAccent: '0 4px 16px rgba(123, 127, 242, 0.20), 0 2px 4px rgba(123, 127, 242, 0.10)'
};

interface LoginProps {
    onLogin: () => void;
}

function Login({ onLogin }: LoginProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        // Simulate login - in a real app, this would call an API
        setTimeout(() => {
            setIsLoading(false);
            // For now, just proceed to main app
            onLogin();
        }, 800);
    };

    const handleSkip = () => {
        onLogin();
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            background: COLORS.bg,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            color: COLORS.text,
            overflow: 'auto'
        }}>
            {/* Header */}
            <div style={{
                padding: '24px',
                textAlign: 'center',
                borderBottom: `1px solid ${COLORS.borderLight}`,
                background: COLORS.white,
                boxShadow: '0 1px 3px rgba(123, 127, 242, 0.05)'
            }}>
                <div style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '14px',
                    background: 'linear-gradient(135deg, #666AD1 0%, #7B7FF2 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: COLORS.shadowMd,
                    margin: '0 auto 16px'
                }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                    </svg>
                </div>
                <h1 style={{
                    margin: 0,
                    fontSize: '22px',
                    fontWeight: 700,
                    letterSpacing: '-0.3px'
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
                    margin: '6px 0 0',
                    fontSize: '13px',
                    color: COLORS.textMuted
                }}>
                    Sign in to continue
                </p>
            </div>

            {/* Form */}
            <div style={{
                flex: 1,
                padding: '24px',
                display: 'flex',
                flexDirection: 'column'
            }}>
                <form onSubmit={handleSubmit} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px'
                }}>
                    {/* Email Input */}
                    <div>
                        <label style={{
                            display: 'block',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: COLORS.textSecondary,
                            marginBottom: '6px'
                        }}>
                            Email Address
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            style={{
                                width: '100%',
                                padding: '12px 14px',
                                fontSize: '14px',
                                border: `1px solid ${COLORS.border}`,
                                borderRadius: '10px',
                                background: COLORS.white,
                                color: COLORS.text,
                                outline: 'none',
                                transition: 'border-color 0.2s ease',
                                boxSizing: 'border-box'
                            }}
                            onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                            onBlur={(e) => e.target.style.borderColor = COLORS.border}
                        />
                    </div>

                    {/* Password Input */}
                    <div>
                        <label style={{
                            display: 'block',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: COLORS.textSecondary,
                            marginBottom: '6px'
                        }}>
                            Password
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            style={{
                                width: '100%',
                                padding: '12px 14px',
                                fontSize: '14px',
                                border: `1px solid ${COLORS.border}`,
                                borderRadius: '10px',
                                background: COLORS.white,
                                color: COLORS.text,
                                outline: 'none',
                                transition: 'border-color 0.2s ease',
                                boxSizing: 'border-box'
                            }}
                            onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                            onBlur={(e) => e.target.style.borderColor = COLORS.border}
                        />
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div style={{
                            padding: '10px 14px',
                            background: '#FFF5F5',
                            border: `1px solid ${COLORS.error}20`,
                            borderRadius: '8px',
                            fontSize: '12px',
                            color: COLORS.error,
                            fontWeight: 500
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isLoading}
                        style={{
                            width: '100%',
                            padding: '14px',
                            background: `linear-gradient(135deg, ${COLORS.accentDark} 0%, ${COLORS.accent} 100%)`,
                            border: 'none',
                            borderRadius: '10px',
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                            fontSize: '14px',
                            color: COLORS.white,
                            boxShadow: COLORS.shadowAccent,
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            marginTop: '8px',
                            opacity: isLoading ? 0.7 : 1
                        }}
                    >
                        {isLoading ? (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                                    <path d="M23 4v6h-6M1 20v-6h6" />
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                </svg>
                                Signing in...
                            </>
                        ) : (
                            <>
                                Sign In
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                    <polyline points="12 5 19 12 12 19" />
                                </svg>
                            </>
                        )}
                    </button>
                </form>

                {/* Divider */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    margin: '24px 0'
                }}>
                    <div style={{ flex: 1, height: '1px', background: COLORS.border }} />
                    <span style={{ fontSize: '12px', color: COLORS.textMuted }}>or</span>
                    <div style={{ flex: 1, height: '1px', background: COLORS.border }} />
                </div>

                {/* Skip Button */}
                <button
                    onClick={handleSkip}
                    style={{
                        width: '100%',
                        padding: '14px',
                        background: COLORS.bgSecondary,
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: '10px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '14px',
                        color: COLORS.textSecondary,
                        transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = COLORS.bgHover;
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = COLORS.bgSecondary;
                    }}
                >
                    Continue without signing in
                </button>

                {/* Info Text */}
                <p style={{
                    marginTop: '20px',
                    fontSize: '11px',
                    color: COLORS.textMuted,
                    textAlign: 'center',
                    lineHeight: 1.5
                }}>
                    Sign in to sync your preferences and access premium features
                </p>
            </div>

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

export default Login;
