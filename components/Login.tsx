/**
 * PIXORA - Login Screen
 * User authentication (placeholder for future implementation)
 */

import './App.css';

interface LoginProps {
    onLogin: () => void;
}

const COLORS = {
    primary: '#2563EB',
    primaryHover: '#1D4ED8',
    primarySoft: '#EFF6FF',
    surface: '#FFFFFF',
    background: '#F8FAFC',
    text: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    border: '#E2E8F0',
    shadowPrimary: '0 4px 14px rgba(37, 99, 235, 0.25)',
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
};

function Login({ onLogin }: LoginProps) {
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
                width: '64px',
                height: '64px',
                borderRadius: '18px',
                background: `linear-gradient(135deg, ${COLORS.primary} 0%, #3B82F6 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: COLORS.shadowPrimary,
                marginBottom: '24px'
            }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
            </div>

            {/* Header */}
            <h2 style={{
                fontSize: '20px',
                fontWeight: 700,
                color: COLORS.text,
                marginBottom: '8px',
                letterSpacing: '-0.3px'
            }}>
                Welcome back
            </h2>

            <p style={{
                fontSize: '13px',
                color: COLORS.textMuted,
                marginBottom: '32px',
                maxWidth: '240px',
                lineHeight: 1.5
            }}>
                Sign in to access all features and sync your preferences
            </p>

            {/* Login Form Card */}
            <div style={{
                width: '100%',
                maxWidth: '300px',
                background: COLORS.surface,
                borderRadius: '16px',
                padding: '24px',
                boxShadow: COLORS.shadowSm,
                marginBottom: '20px'
            }}>
                {/* Email Input */}
                <div style={{ marginBottom: '16px' }}>
                    <label style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 500,
                        color: COLORS.textSecondary,
                        marginBottom: '6px',
                        textAlign: 'left'
                    }}>
                        Email
                    </label>
                    <input
                        type="email"
                        placeholder="you@example.com"
                        style={{
                            width: '100%',
                            padding: '12px 14px',
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: '10px',
                            fontSize: '14px',
                            fontFamily: 'inherit',
                            color: COLORS.text,
                            background: COLORS.background,
                            outline: 'none',
                            transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
                        }}
                        onFocus={(e) => {
                            e.target.style.borderColor = COLORS.primary;
                            e.target.style.boxShadow = `0 0 0 3px ${COLORS.primarySoft}`;
                        }}
                        onBlur={(e) => {
                            e.target.style.borderColor = COLORS.border;
                            e.target.style.boxShadow = 'none';
                        }}
                    />
                </div>

                {/* Password Input */}
                <div style={{ marginBottom: '24px' }}>
                    <label style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 500,
                        color: COLORS.textSecondary,
                        marginBottom: '6px',
                        textAlign: 'left'
                    }}>
                        Password
                    </label>
                    <input
                        type="password"
                        placeholder="••••••••"
                        style={{
                            width: '100%',
                            padding: '12px 14px',
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: '10px',
                            fontSize: '14px',
                            fontFamily: 'inherit',
                            color: COLORS.text,
                            background: COLORS.background,
                            outline: 'none',
                            transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
                        }}
                        onFocus={(e) => {
                            e.target.style.borderColor = COLORS.primary;
                            e.target.style.boxShadow = `0 0 0 3px ${COLORS.primarySoft}`;
                        }}
                        onBlur={(e) => {
                            e.target.style.borderColor = COLORS.border;
                            e.target.style.boxShadow = 'none';
                        }}
                    />
                </div>

                {/* Sign In Button */}
                <button
                    onClick={onLogin}
                    style={{
                        width: '100%',
                        padding: '14px',
                        background: COLORS.primary,
                        border: 'none',
                        borderRadius: '12px',
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#fff',
                        cursor: 'pointer',
                        boxShadow: COLORS.shadowPrimary,
                        transition: 'all 0.2s ease'
                    }}
                >
                    Sign In
                </button>
            </div>

            {/* Skip Option */}
            <button
                onClick={onLogin}
                style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: COLORS.textMuted,
                    cursor: 'pointer',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    transition: 'color 0.2s ease'
                }}
            >
                Continue without signing in →
            </button>

            {/* Footer */}
            <p style={{
                marginTop: 'auto',
                paddingTop: '24px',
                fontSize: '11px',
                color: COLORS.textMuted
            }}>
                By continuing, you agree to our Terms of Service
            </p>
        </div>
    );
}

export default Login;
