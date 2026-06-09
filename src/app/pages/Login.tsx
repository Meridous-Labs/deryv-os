import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
const DERYV_LOGO = 'https://byzjsafupehesiwbqkxt.supabase.co/storage/v1/object/public/brand-assets/deryv-logo.png';

const LAST_ROUTE_KEY = 'deryv.lastRoute';
const PROTECTED_ROOTS = [
  '/command-center', '/lot-intake', '/inventory', '/warehouse',
  '/marketplace', '/orders', '/shipping', '/returns', '/partners',
  '/reports', '/integrations', '/ai-ops', '/settings',
];

function resolvePostLoginRoute(): string {
  const last = localStorage.getItem(LAST_ROUTE_KEY);
  if (last && PROTECTED_ROOTS.some(r => last.startsWith(r))) return last;
  return '/command-center';
}

export function Login() {
  const { signIn, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      navigate(resolvePostLoginRoute(), { replace: true });
    }
  }, [authLoading, user, navigate]);

  if (authLoading || (!authLoading && user)) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    if (mode === 'signup') {
      // Validate sign-up fields
      if (!name || !email || !password || !confirmPassword) {
        setError('All fields are required');
        setLoading(false);
        return;
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }

      // Sign up
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
        },
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          setError('Email already registered');
        } else {
          setError(signUpError.message);
        }
        setLoading(false);
      } else {
        setSuccessMessage('Check your email to confirm your account');
        setLoading(false);
        // Clear form
        setName('');
        setEmail('');
        setPassword('');
        setConfirmPassword('');
      }
    } else {
      // Sign in
      if (!email || !password) {
        setError('Email and password are required');
        setLoading(false);
        return;
      }

      const { error: signInError } = await signIn(email, password);
      if (signInError) {
        if (signInError.includes('Email not confirmed')) {
          setError('Email not confirmed - check your inbox');
        } else if (signInError.includes('Invalid') || signInError.includes('invalid')) {
          setError('Invalid email or password');
        } else {
          setError(signInError);
        }
        setLoading(false);
      } else {
        navigate(resolvePostLoginRoute(), { replace: true });
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F5F6] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[360px]">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src={DERYV_LOGO} alt="deryv" className="h-16 w-auto object-contain mb-2" />
          <p className="text-[13px] text-gray-400">operate. sync. grow.</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-[rgba(0,0,0,0.08)] shadow-sm p-8">
          {/* Mode Toggle */}
          <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
                setSuccessMessage(null);
              }}
              className={`flex-1 py-2 text-[13px] font-medium rounded-md transition-colors ${
                mode === 'signin'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
                setSuccessMessage(null);
              }}
              className={`flex-1 py-2 text-[13px] font-medium rounded-md transition-colors ${
                mode === 'signup'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sign Up
            </button>
          </div>

          <div className="mb-6">
            <h1 className="text-[18px] font-semibold text-gray-900">
              {mode === 'signin' ? 'Sign in to deryv' : 'Create your account'}
            </h1>
            <p className="text-[13px] text-gray-400 mt-1">
              {mode === 'signin'
                ? 'Enter your credentials to access your workspace'
                : 'Sign up to get started with deryv'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  required
                  className="w-full px-3 py-2.5 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] placeholder:text-gray-400 bg-white transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
                className="w-full px-3 py-2.5 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] placeholder:text-gray-400 bg-white transition-colors"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  className="w-full px-3 py-2.5 pr-10 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] placeholder:text-gray-400 bg-white transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {mode === 'signup' && (
              <div>
                <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">Confirm Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                  className="w-full px-3 py-2.5 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] placeholder:text-gray-400 bg-white transition-colors"
                />
              </div>
            )}

            {successMessage && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-100 rounded-lg">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                <p className="text-[12px] text-green-600">{successMessage}</p>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                <p className="text-[12px] text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password || (mode === 'signup' && (!name || !confirmPassword))}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#3ECF8E] hover:bg-[#38c484] active:bg-[#32ba7d] text-white text-[13px] font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading && <Loader2 size={13} className="animate-spin" />}
              {loading
                ? (mode === 'signup' ? 'Creating account...' : 'Signing in...')
                : (mode === 'signup' ? 'Sign up' : 'Sign in')
              }
            </button>
          </form>
        </div>

        {mode === 'signin' && (
          <p className="text-center text-[12px] text-gray-400 mt-6">
            Don't have an account? Use the Sign Up tab above.
          </p>
        )}
      </div>
    </div>
  );
}
