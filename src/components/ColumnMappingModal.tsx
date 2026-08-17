import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';

interface ColumnMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileColumns: string[];
  suggestedMappings: Record<string, string | null>;
  sampleData: Record<string, string>[];
  filename: string;
  totalRows: number;
  onConfirm: (mappings: Record<string, string>) => void;
}

const DATABASE_FIELDS = [
  { key: 'email', label: 'Email', required: true, description: 'Contact email address' },
  { key: 'name', label: 'Name', required: false, description: 'Full name of contact' },
  { key: 'company', label: 'Company', required: false, description: 'Company name' },
  { key: 'title', label: 'Title', required: false, description: 'Job title or position' },
  { key: 'phone', label: 'Phone', required: false, description: 'Phone number' },
  { key: 'industry', label: 'Industry', required: false, description: 'Business sector' },
  { key: 'location', label: 'Location', required: false, description: 'City, state, or country' },
  { key: 'notes', label: 'Notes', required: false, description: 'Additional information' },
];

export function ColumnMappingModal({
  isOpen,
  onClose,
  fileColumns,
  suggestedMappings,
  sampleData,
  filename,
  totalRows,
  onConfirm
}: ColumnMappingModalProps) {
  const [mappings, setMappings] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(suggestedMappings).filter(([_, v]) => v !== null) as [string, string][]
    )
  );

  const handleMappingChange = (dbField: string, fileColumn: string) => {
    setMappings(prev => ({
      ...prev,
      [dbField]: fileColumn
    }));
  };

  const handleConfirm = () => {
    // Only send mappings that have values
    const finalMappings = Object.fromEntries(
      Object.entries(mappings).filter(([_, v]) => v && v !== '')
    );
    onConfirm(finalMappings);
  };

  const isEmailMapped = mappings.email && mappings.email !== '';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-40"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl"
            >
            {/* Header */}
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-indigo-50">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-1">Map Your Columns</h2>
                  <p className="text-sm text-gray-600">
                    {filename} • {totalRows} rows • Match your file columns to database fields
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Email Warning */}
              {!isEmailMapped && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-900">Email column required</p>
                    <p className="text-sm text-red-700">You must map an email column to proceed with import</p>
                  </div>
                </div>
              )}

              {/* Mapping Grid */}
              <div className="space-y-4">
                {DATABASE_FIELDS.map((field) => {
                  const currentMapping = mappings[field.key] || '';
                  const isMapped = currentMapping !== '';

                  return (
                    <div
                      key={field.key}
                      className={`p-5 border-2 rounded-xl transition-all ${
                        field.required && !isMapped
                          ? 'border-red-300 bg-red-50'
                          : isMapped
                          ? 'border-green-300 bg-green-50'
                          : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-4 mb-3">
                        {/* Database Field */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-gray-900 text-base">{field.label}</p>
                            {field.required && (
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded shrink-0">
                                Required
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600">{field.description}</p>
                        </div>

                        {/* Arrow */}
                        <ArrowRight className={`h-6 w-6 shrink-0 ${
                          isMapped ? 'text-green-600' : 'text-gray-400'
                        }`} />

                        {/* File Column Dropdown */}
                        <div className="min-w-0">
                          <select
                            value={currentMapping}
                            onChange={(e) => handleMappingChange(field.key, e.target.value)}
                            className={`w-full px-4 py-2.5 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors ${
                              field.required && !isMapped
                                ? 'border-red-300 bg-white'
                                : isMapped
                                ? 'border-green-300 bg-white'
                                : 'border-gray-300 bg-white'
                            }`}
                          >
                            <option value="">-- Select Column --</option>
                            {fileColumns.map((col) => (
                              <option key={col} value={col}>
                                {col}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Status Icon */}
                        <div className="w-6 shrink-0 flex items-center justify-center">
                          {isMapped && (
                            <CheckCircle className="h-6 w-6 text-green-600" />
                          )}
                        </div>
                      </div>

                      {/* Sample Data Preview */}
                      {isMapped && currentMapping && sampleData.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-xs font-semibold text-gray-600 mb-2">Sample values:</p>
                          <div className="flex gap-2 flex-wrap">
                            {sampleData.slice(0, 3).map((row, idx) => {
                              const normalizedKey = currentMapping.toLowerCase().replace(/ /g, '_');
                              const value = row[normalizedKey];
                              return value ? (
                                <span
                                  key={idx}
                                  className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded border border-gray-300"
                                >
                                  {value.substring(0, 30)}{value.length > 30 ? '...' : ''}
                                </span>
                              ) : null;
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 p-6 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-gray-700">
                  {Object.keys(mappings).filter(k => mappings[k]).length} of {DATABASE_FIELDS.length} fields mapped
                </div>
                {isEmailMapped ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600" />
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors font-medium text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!isEmailMapped}
                  className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  Confirm & Import
                </button>
              </div>
            </div>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
