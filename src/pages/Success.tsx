import { motion } from 'framer-motion';
import { CheckCircle, Mail, Phone } from 'lucide-react';
import { getConfig } from '../lib/config';

export function Success() {
  const config = getConfig();
  const companyName = config.company?.name || 'UtilizeReach';
  const successMessage =
    config.form?.successMessage ||
    'Thank you! Our team will review your information and reach out within 24 hours.';
  const email = config.company?.email;
  const phone = config.company?.phone;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center px-4">
      <motion.div
        className="max-w-2xl w-full"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 sm:p-12 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="inline-block"
          >
            <CheckCircle size={80} className="text-green-500 mx-auto mb-6" />
          </motion.div>

          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Thank You for Your Interest!
          </h1>

          <p className="text-lg text-gray-600 mb-8">
            {successMessage}
          </p>

          <div className="bg-blue-50 rounded-2xl p-6 mb-8 text-left">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              What Happens Next?
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm">
                  1
                </div>
                <p className="text-gray-700 pt-1">
                  Our team will review your submission and prepare a personalized response
                </p>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm">
                  2
                </div>
                <p className="text-gray-700 pt-1">
                  We'll reach out via your preferred contact method to discuss your needs
                </p>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm">
                  3
                </div>
                <p className="text-gray-700 pt-1">
                  Together, we'll find the solution that fits you best — no obligation
                </p>
              </div>
            </div>
          </div>

          {(phone || email) && (
            <div className="border-t pt-6">
              <p className="text-gray-600 mb-4">
                Need immediate assistance? Contact us directly:
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                {phone && (
                  <a
                    href={`tel:${phone.replace(/[^+\d]/g, '')}`}
                    className="flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
                  >
                    <Phone size={18} />
                    {phone}
                  </a>
                )}
                {email && (
                  <a
                    href={`mailto:${email}`}
                    className="flex items-center justify-center gap-2 px-5 py-3 border-2 border-blue-200 text-blue-600 rounded-xl font-medium hover:bg-blue-50 transition-colors"
                  >
                    <Mail size={18} />
                    Email Us
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="mt-8">
            <a href="/" className="text-blue-600 hover:text-blue-700 text-sm font-medium">
              ← Back to {companyName}
            </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
