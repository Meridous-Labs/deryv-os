import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router';
import { AlertTriangle } from 'lucide-react';

export function RouteErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();

  let title = 'Something went wrong';
  let detail = 'An unexpected error occurred. Try refreshing the page.';

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    detail = typeof error.data === 'string' ? error.data : detail;
  } else if (error instanceof Error) {
    detail = error.message;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl border border-[rgba(0,0,0,0.08)] p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={22} className="text-red-500" />
          </div>
          <h2 className="text-gray-900 mb-2">{title}</h2>
          <p className="text-[13px] text-gray-400 mb-6 leading-relaxed">{detail}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Go back
            </button>
            <button
              onClick={() => navigate('/command-center')}
              className="px-4 py-2 text-[13px] bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg font-medium transition-colors"
            >
              Command Center
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
