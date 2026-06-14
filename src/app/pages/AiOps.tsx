import { useState, useEffect } from 'react';
import { Sparkles, FileText, TrendingUp, AlertTriangle, Send, Loader, Zap, ArrowRight, PlayCircle, DollarSign, History, CheckCircle, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, logActivity } from '../../lib/hooks';
import { useSecondaryView } from '../components/SecondarySidebar';
import { supabase } from '../../lib/supabase';
import { Modal, FormField, DetailRow } from '../components/DataStates';

async function callAIOps(endpoint: string, payload: any) {
  const { data, error } = await supabase.functions.invoke('ai-ops', {
    body: { endpoint, ...payload },
  });

  if (error) {
    throw new Error(error.message || 'AI operation failed');
  }

  if (data?.success === false) {
    throw new Error(data.error || 'AI operation failed');
  }

  return data;
}

export function AiOps() {
  const view = useSecondaryView();
  const navigate = useNavigate();
  const { orgId, user } = useAuth();

  // Listing Generator State
  const [selectedItemId, setSelectedItemId] = useState('');
  const [generatingListing, setGeneratingListing] = useState(false);
  const [listingResult, setListingResult] = useState<any>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  const [creatingListing, setCreatingListing] = useState(false);

  // Manifest Review State
  const [selectedManifestId, setSelectedManifestId] = useState('');
  const [reviewingManifest, setReviewingManifest] = useState(false);
  const [manifestReview, setManifestReview] = useState<any>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);

  // Pricing Assistant State
  const [selectedPricingItemId, setSelectedPricingItemId] = useState('');
  const [generatingPrice, setGeneratingPrice] = useState(false);
  const [pricingResult, setPricingResult] = useState<any>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [applyingPrice, setApplyingPrice] = useState(false);

  // Chat State
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Hello — I\'m your deryv AI assistant. Ask me anything about inventory, LOTs, recovery rates, or operations.' },
  ]);
  const [chatLoading, setChatLoading] = useState(false);

  // AI Runs History State
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Eligible inventory items for AI operations
  const { data: eligibleItems, loading: itemsLoading, error: itemsError } = useOrgQuery<any>('inventory_items', orgId, {
    select: 'id, inventory_id, product_title, brand, model, category, sku, upc, serial_number, status, condition, grade, msrp, current_asking_price, weighted_acquisition_cost, component_cost, supply_cost, total_cost_basis, notes, lot_id, lots(id, lot_id)',
    filter: (q: any) => q.order('created_at', { ascending: false }),
  });

  const { data: manifests } = useOrgQuery<any>('manifest_imports', orgId, {
    select: 'id, source_file_name, status, item_count, normalized_items, parsed_rows, row_count, created_at',
  });

  const { data: lots } = useOrgQuery<any>('lots', orgId, { select: 'lot_id, status' });
  const { data: orders } = useOrgQuery<any>('orders', orgId, { select: 'order_id, total_amount, status' });
  const { data: listings } = useOrgQuery<any>('marketplace_listings', orgId, { select: 'id, status, sync_status' });

  const { data: aiRuns, reload: reloadRuns } = useOrgQuery<any>('ai_runs', orgId, {
    select: 'id, run_type, entity_type, status, created_at, output',
    filter: (q: any) => q.order('created_at', { ascending: false }).limit(20),
  });

  const activeItems = eligibleItems.filter((i: any) => i.status === 'ACTIVE').length;
  const errorListings = listings.filter((l: any) => l.sync_status === 'ERROR' || l.status === 'ERROR').length;

  const insights = [
    ...(activeItems > 0 ? [{
      type: 'opportunity', icon: TrendingUp, title: 'Active Inventory Ready',
      message: `${activeItems} items are currently ACTIVE and ready for listing. Use AI to generate optimized listings.`,
      cta: 'Generate listings',
      action: () => navigate('/ai-ops/listing-gen'),
    }] : []),
    ...(errorListings > 0 ? [{
      type: 'anomaly', icon: AlertTriangle, title: 'Listing Sync Errors',
      message: `${errorListings} marketplace listing${errorListings > 1 ? 's have' : ' has'} sync errors. Review and resolve.`,
      cta: 'View errors',
      action: () => navigate('/marketplace/error'),
    }] : []),
    ...(manifests.length > 0 ? [{
      type: 'suggestion', icon: FileText, title: 'Manifest Review Available',
      message: `${manifests.length} manifest${manifests.length > 1 ? 's' : ''} ready for AI review. Identify missing data and corrections.`,
      cta: 'Review manifests',
      action: () => navigate('/ai-ops/manifest'),
    }] : []),
  ];

  // Generate Listing
  const handleGenerateListing = async () => {
    setListingError(null);

    // Validate required fields
    if (!orgId) {
      setListingError('Organization not selected');
      return;
    }
    if (!user?.id) {
      setListingError('User not authenticated');
      return;
    }
    if (!selectedItemId) {
      setListingError('Please select an inventory item');
      return;
    }

    // Verify item exists in dropdown
    const selectedItem = eligibleItems.find((i: any) => i.id === selectedItemId);
    if (!selectedItem) {
      setListingError('Selected inventory item not found');
      return;
    }

    setGeneratingListing(true);
    setListingResult(null);

    try {
      // Query the actual inventory item from database
      const { data: inventoryItem, error: queryError } = await supabase
        .from('inventory_items')
        .select('id, inventory_id, product_title, brand, model, category, sku, upc, serial_number, condition, status, msrp, weighted_acquisition_cost, component_cost, supply_cost, total_cost_basis, notes')
        .eq('id', selectedItemId)
        .eq('organization_id', orgId)
        .single();

      if (queryError || !inventoryItem) {
        setListingError('Failed to load inventory item details');
        return;
      }

      console.log('Selected Inventory Item', inventoryItem);

      const payload = {
        organization_id: orgId,
        user_id: user.id,
        run_type: 'LISTING_DRAFT',
        entity_type: 'inventory_items',
        entity_id: selectedItemId,
        input: {
          id: inventoryItem.id,
          inventory_id: inventoryItem.inventory_id,
          product_title: inventoryItem.product_title,
          brand: inventoryItem.brand,
          model: inventoryItem.model,
          category: inventoryItem.category,
          sku: inventoryItem.sku,
          upc: inventoryItem.upc,
          serial_number: inventoryItem.serial_number,
          condition: inventoryItem.condition,
          status: inventoryItem.status,
          msrp: inventoryItem.msrp,
          weighted_acquisition_cost: inventoryItem.weighted_acquisition_cost,
          component_cost: inventoryItem.component_cost,
          supply_cost: inventoryItem.supply_cost,
          total_cost_basis: inventoryItem.total_cost_basis,
          notes: inventoryItem.notes,
        },
      };

      console.log('AI Payload', payload);

      const result = await callAIOps('/generate-listing', payload);

      setListingResult(result.output || result);
      await logActivity(orgId, user.id, 'AI listing draft generated', 'inventory_items', selectedItemId);
      reloadRuns();
    } catch (error: any) {
      setListingError(error.message || 'Failed to generate listing');
    } finally {
      setGeneratingListing(false);
    }
  };

  // Create Draft Listing
  const handleCreateListing = async () => {
    if (!listingResult || !selectedItemId) return;

    setCreatingListing(true);

    try {
      const { data: newListing, error } = await insertRow('marketplace_listings', {
        organization_id: orgId,
        inventory_item_id: selectedItemId,
        channel: 'EBAY',
        status: 'DRAFT',
        sync_status: 'PENDING',
        title: listingResult.title,
        price: listingResult.recommended_price || 0,
        listing_url: null,
        marketplace_listing_id: null,
      });

      if (error) {
        alert('Failed to create listing: ' + error);
        return;
      }

      await logActivity(orgId, user?.id, 'Draft listing created from AI', 'marketplace_listings', newListing.id);
      navigate(`/marketplace/all?selected=${newListing.id}`);
    } catch (error: any) {
      alert('Failed to create listing: ' + error.message);
    } finally {
      setCreatingListing(false);
    }
  };

  // Review Manifest
  const handleReviewManifest = async () => {
    setManifestError(null);

    // Validate required fields
    if (!orgId) {
      setManifestError('Organization not selected');
      return;
    }
    if (!user?.id) {
      setManifestError('User not authenticated');
      return;
    }
    if (!selectedManifestId) {
      setManifestError('Please select a manifest');
      return;
    }

    // Verify manifest exists
    const selectedManifest = manifests.find((m: any) => m.id === selectedManifestId);
    if (!selectedManifest) {
      setManifestError('Selected manifest not found');
      return;
    }

    setReviewingManifest(true);
    setManifestReview(null);

    try {
      const result = await callAIOps('/review-manifest', {
        organization_id: orgId,
        user_id: user.id,
        run_type: 'MANIFEST_REVIEW',
        entity_type: 'manifest_imports',
        entity_id: selectedManifestId,
        input: { manifest_import_id: selectedManifestId },
      });

      setManifestReview(result.output || result);
      await logActivity(orgId, user.id, 'AI manifest review completed', 'manifest_imports', selectedManifestId);
      reloadRuns();
    } catch (error: any) {
      setManifestError(error.message || 'Failed to review manifest');
    } finally {
      setReviewingManifest(false);
    }
  };

  // Suggest Pricing
  const handleSuggestPricing = async () => {
    setPricingError(null);

    // Validate required fields
    if (!orgId) {
      setPricingError('Organization not selected');
      return;
    }
    if (!user?.id) {
      setPricingError('User not authenticated');
      return;
    }
    if (!selectedPricingItemId) {
      setPricingError('Please select an inventory item');
      return;
    }

    // Verify item exists
    const selectedItem = eligibleItems.find((i: any) => i.id === selectedPricingItemId);
    if (!selectedItem) {
      setPricingError('Selected inventory item not found');
      return;
    }

    setGeneratingPrice(true);
    setPricingResult(null);

    try {
      const result = await callAIOps('/suggest-pricing', {
        organization_id: orgId,
        user_id: user.id,
        run_type: 'PRICING_ANALYSIS',
        entity_type: 'inventory_items',
        entity_id: selectedPricingItemId,
        input: { inventory_item_id: selectedPricingItemId },
      });

      setPricingResult(result.output || result);
      await logActivity(orgId, user.id, 'AI pricing suggestion generated', 'inventory_items', selectedPricingItemId);
      reloadRuns();
    } catch (error: any) {
      setPricingError(error.message || 'Failed to suggest pricing');
    } finally {
      setGeneratingPrice(false);
    }
  };

  // Apply Price
  const handleApplyPrice = async () => {
    if (!pricingResult || !selectedPricingItemId) return;

    setApplyingPrice(true);

    try {
      const { error } = await supabase
        .from('inventory_items')
        .update({ current_asking_price: pricingResult.recommended_price })
        .eq('id', selectedPricingItemId)
        .eq('organization_id', orgId);

      if (error) throw error;

      await logActivity(orgId, user?.id, `Price updated to $${pricingResult.recommended_price} from AI suggestion`, 'inventory_items', selectedPricingItemId);
      alert('Price updated successfully!');
      setPricingResult(null);
      setSelectedPricingItemId('');
    } catch (error: any) {
      alert('Failed to apply price: ' + error.message);
    } finally {
      setApplyingPrice(false);
    }
  };

  // Send Chat
  const sendChat = async () => {
    if (!chatInput.trim()) return;

    // Validate required fields
    if (!orgId) {
      setChatMessages(m => [...m, { role: 'assistant', content: 'Error: Organization not selected' }]);
      return;
    }
    if (!user?.id) {
      setChatMessages(m => [...m, { role: 'assistant', content: 'Error: User not authenticated' }]);
      return;
    }

    const msg = chatInput;
    setChatInput('');
    setChatMessages(m => [...m, { role: 'user', content: msg }]);
    setChatLoading(true);

    try {
      const result = await callAIOps('/chat', {
        organization_id: orgId,
        user_id: user.id,
        run_type: 'OPERATIONS_CHAT',
        entity_type: 'chat',
        entity_id: null,
        input: { message: msg },
      });

      const output = result.output || result;
      setChatMessages(m => [...m, { role: 'assistant', content: output.response || output }]);

      if (output.suggested_action?.type === 'navigate' && output.suggested_action.path) {
        setChatMessages(m => [...m, {
          role: 'assistant',
          content: `[Action: ${output.suggested_action.description}]`,
          action: { path: output.suggested_action.path }
        }]);
      }

      reloadRuns();
    } catch (error: any) {
      setChatMessages(m => [...m, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const selectedRun = aiRuns.find((r: any) => r.id === selectedRunId);

  const selectedItem = eligibleItems.find((i: any) => i.id === selectedItemId);
  const selectedPricingItem = eligibleItems.find((i: any) => i.id === selectedPricingItemId);

  const showOverview = view === 'overview' || view === 'insights';
  const showListing = view === 'overview' || view === 'listing-gen';
  const showManifest = view === 'overview' || view === 'manifest';
  const showPricing = view === 'overview' || view === 'pricing';
  const showChat = view === 'overview' || view === 'suggestions';
  const showHistory = view === 'overview' || view === 'history';

  return (
    <div className="p-3 sm:p-6 max-w-[1200px] space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">AI Ops</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">AI-native operational intelligence</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#ECFDF5] border border-[#BBF7D0] rounded-lg">
          <div className="w-1.5 h-1.5 rounded-full bg-[#3ECF8E] animate-pulse" />
          <span className="text-[12px] font-medium text-[#16a34a]">AI Active · deryv Intelligence</span>
        </div>
      </div>

      {showOverview && insights.length > 0 && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.06)] flex items-center gap-2">
            <Zap size={12} className="text-[#3ECF8E]" />
            <h3 className="text-[13px] font-semibold text-gray-900">Operational Insights</h3>
          </div>
          <div className="divide-y divide-[rgba(0,0,0,0.04)]">
            {insights.map((insight, idx) => {
              const Icon = insight.icon;
              return (
                <div key={idx} className="flex gap-4 px-5 py-4 hover:bg-gray-50/60 transition-colors">
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon size={13} className="text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold text-gray-900">{insight.title}</p>
                    <p className="text-[13px] text-gray-500 mt-0.5 leading-relaxed">{insight.message}</p>
                    <button onClick={insight.action} className="text-[12px] text-[#3ECF8E] font-medium mt-1.5 flex items-center gap-0.5 hover:underline">
                      {insight.cta} <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {showListing && (
          <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={13} className="text-[#3ECF8E]" />
              <h3 className="text-[13px] font-semibold text-gray-900">Listing Draft Generator</h3>
            </div>
            <div className="mb-3">
              <label className="text-[11px] text-gray-400 mb-1 block uppercase tracking-wide">Inventory Item</label>
              {itemsError ? (
                <div className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">
                  Failed to load inventory items. Check console for details.
                </div>
              ) : (
                <select className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none bg-white"
                  value={selectedItemId} onChange={e => { setSelectedItemId(e.target.value); setListingResult(null); setListingError(null); }}
                  disabled={itemsLoading}>
                  <option value="">
                    {itemsLoading ? 'Loading...' : eligibleItems.length === 0 ? 'No eligible inventory items found' : '— Select item —'}
                  </option>
                  {eligibleItems.map((item: any) => {
                    const label = item.inventory_id && item.product_title
                      ? `${item.inventory_id} — ${item.product_title}`
                      : item.inventory_id || item.product_title || (item.brand && item.model ? `${item.brand} ${item.model}` : 'Unnamed inventory item');
                    return (
                      <option key={item.id} value={item.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              )}
              {!itemsError && !itemsLoading && eligibleItems.length === 0 && (
                <p className="text-[11px] text-gray-500 mt-1">
                  No eligible inventory items found. Check Inventory statuses or create/import inventory first.
                </p>
              )}
            </div>

            {listingError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                <p className="text-[12px] text-red-600">{listingError}</p>
              </div>
            )}

            {!listingResult ? (
              <button
                onClick={handleGenerateListing}
                disabled={generatingListing || !selectedItemId}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-xl disabled:opacity-60"
              >
                {generatingListing ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {generatingListing ? 'Generating...' : 'Generate Listing Draft'}
              </button>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-gray-400 block mb-1 uppercase tracking-wide">AI Title</label>
                  <div className="bg-gray-50 border border-[rgba(0,0,0,0.07)] rounded-lg p-2.5 text-[13px] text-gray-900">
                    {listingResult.title || 'N/A'}
                  </div>
                </div>
                {listingResult.subtitle && (
                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1 uppercase tracking-wide">Subtitle</label>
                    <div className="bg-gray-50 border border-[rgba(0,0,0,0.07)] rounded-lg p-2.5 text-[13px] text-gray-700">
                      {listingResult.subtitle}
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-[11px] text-gray-400 block mb-1 uppercase tracking-wide">Recommended Price</label>
                  <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-2.5 flex justify-between">
                    <span className="text-[15px] font-bold text-gray-900">${listingResult.recommended_price || 0}</span>
                    <span className="text-[11px] text-[#16a34a]">Confidence: {((listingResult.confidence || 0) * 100).toFixed(0)}%</span>
                  </div>
                </div>
                {listingResult.missing_data && listingResult.missing_data.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2.5">
                    <p className="text-[11px] text-yellow-700">Missing data: {listingResult.missing_data.join(', ')}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateListing}
                    disabled={creatingListing}
                    className="flex-1 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60"
                  >
                    {creatingListing ? <Loader size={13} className="animate-spin inline mr-1" /> : null}
                    Create Draft Listing
                  </button>
                  <button onClick={() => setListingResult(null)} className="px-3 py-2 border border-[rgba(0,0,0,0.1)] text-[12px] text-gray-500 rounded-lg hover:bg-gray-50">Redo</button>
                </div>
              </div>
            )}
          </div>
        )}

        {showPricing && (
          <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign size={13} className="text-[#3ECF8E]" />
              <h3 className="text-[13px] font-semibold text-gray-900">Pricing Assistant</h3>
            </div>
            <div className="mb-3">
              <label className="text-[11px] text-gray-400 mb-1 block uppercase tracking-wide">Inventory Item</label>
              {itemsError ? (
                <div className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">
                  Failed to load inventory items. Check console for details.
                </div>
              ) : (
                <select className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none bg-white"
                  value={selectedPricingItemId} onChange={e => { setSelectedPricingItemId(e.target.value); setPricingResult(null); setPricingError(null); }}
                  disabled={itemsLoading}>
                  <option value="">
                    {itemsLoading ? 'Loading...' : eligibleItems.length === 0 ? 'No eligible inventory items found' : '— Select item —'}
                  </option>
                  {eligibleItems.map((item: any) => {
                    const label = item.inventory_id && item.product_title
                      ? `${item.inventory_id} — ${item.product_title}`
                      : item.inventory_id || item.product_title || (item.brand && item.model ? `${item.brand} ${item.model}` : 'Unnamed inventory item');
                    return (
                      <option key={item.id} value={item.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              )}
              {!itemsError && !itemsLoading && eligibleItems.length === 0 && (
                <p className="text-[11px] text-gray-500 mt-1">
                  No eligible inventory items found. Check Inventory statuses or create/import inventory first.
                </p>
              )}
            </div>

            {pricingError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                <p className="text-[12px] text-red-600">{pricingError}</p>
              </div>
            )}

            {!pricingResult ? (
              <button
                onClick={handleSuggestPricing}
                disabled={generatingPrice || !selectedPricingItemId}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-xl disabled:opacity-60"
              >
                {generatingPrice ? <Loader size={13} className="animate-spin" /> : <PlayCircle size={13} />}
                {generatingPrice ? 'Analyzing...' : 'Get AI Pricing'}
              </button>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-gray-400 block mb-1 uppercase tracking-wide">Recommended Price</label>
                  <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-2.5">
                    <span className="text-[18px] font-bold text-gray-900">${pricingResult.recommended_price || 0}</span>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 block mb-1 uppercase tracking-wide">Minimum Profitable</label>
                  <div className="bg-gray-50 border border-[rgba(0,0,0,0.07)] rounded-lg p-2.5">
                    <span className="text-[15px] font-semibold text-gray-900">${pricingResult.minimum_profitable_price || 0}</span>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 block mb-1 uppercase tracking-wide">Rationale</label>
                  <div className="bg-gray-50 border border-[rgba(0,0,0,0.07)] rounded-lg p-2.5 text-[12px] text-gray-700 leading-relaxed">
                    {pricingResult.rationale || 'N/A'}
                  </div>
                </div>
                {pricingResult.missing_inputs && pricingResult.missing_inputs.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2.5">
                    <p className="text-[11px] text-yellow-700">Missing inputs: {pricingResult.missing_inputs.join(', ')}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleApplyPrice}
                    disabled={applyingPrice}
                    className="flex-1 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60"
                  >
                    {applyingPrice ? <Loader size={13} className="animate-spin inline mr-1" /> : null}
                    Apply Price
                  </button>
                  <button onClick={() => setPricingResult(null)} className="px-3 py-2 border border-[rgba(0,0,0,0.1)] text-[12px] text-gray-500 rounded-lg hover:bg-gray-50">Clear</button>
                </div>
              </div>
            )}
          </div>
        )}

        {showManifest && (
          <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={13} className="text-gray-500" />
              <h3 className="text-[13px] font-semibold text-gray-900">Manifest Review Assistant</h3>
            </div>
            <div className="mb-3">
              <label className="text-[11px] text-gray-400 mb-1 block uppercase tracking-wide">Manifest Import</label>
              <select className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none bg-white"
                value={selectedManifestId} onChange={e => { setSelectedManifestId(e.target.value); setManifestReview(null); setManifestError(null); }}>
                <option value="">— Select manifest —</option>
                {manifests.map((m: any) => {
                  const rowCount = m.row_count || m.item_count || m.normalized_items?.length || m.parsed_rows?.length || 0;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.source_file_name || 'Unnamed manifest'} ({rowCount} rows) — {new Date(m.created_at).toLocaleDateString()}
                    </option>
                  );
                })}
              </select>
            </div>

            {manifestError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                <p className="text-[12px] text-red-600">{manifestError}</p>
              </div>
            )}

            {!manifestReview ? (
              <button
                onClick={handleReviewManifest}
                disabled={reviewingManifest || !selectedManifestId}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-[13px] font-medium rounded-xl disabled:opacity-60"
              >
                {reviewingManifest ? <Loader size={13} className="animate-spin" /> : <Zap size={13} />}
                {reviewingManifest ? 'Reviewing...' : 'Review Manifest'}
              </button>
            ) : (
              <div className="space-y-3">
                {manifestReview.rows_needing_review && manifestReview.rows_needing_review.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-[12px] font-semibold text-yellow-800 mb-1">Rows Needing Review</p>
                    <p className="text-[11px] text-yellow-700">{manifestReview.rows_needing_review.length} rows require attention</p>
                  </div>
                )}
                {manifestReview.missing_msrp && manifestReview.missing_msrp.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-[12px] font-semibold text-red-800 mb-1">Missing MSRP</p>
                    <p className="text-[11px] text-red-700">{manifestReview.missing_msrp.length} items missing MSRP values</p>
                  </div>
                )}
                {manifestReview.suggested_corrections && manifestReview.suggested_corrections.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-[12px] font-semibold text-blue-800 mb-1">Suggested Corrections</p>
                    <p className="text-[11px] text-blue-700">{manifestReview.suggested_corrections.length} corrections suggested</p>
                  </div>
                )}
                <button onClick={() => setManifestReview(null)} className="w-full px-3 py-2 border border-[rgba(0,0,0,0.1)] text-[12px] text-gray-500 rounded-lg hover:bg-gray-50">Clear</button>
              </div>
            )}
          </div>
        )}
      </div>

      {showChat && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={13} className="text-[#3ECF8E]" />
            <h3 className="text-[13px] font-semibold text-gray-900">Operational Chat</h3>
          </div>
          <div className="h-52 overflow-y-auto space-y-3 mb-3 pr-2">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] ${msg.role === 'user' ? 'ml-12' : 'mr-12'}`}>
                  <div className={`px-3 py-2 rounded-xl text-[13px] leading-relaxed ${
                    msg.role === 'user' ? 'bg-gray-900 text-white' : 'bg-gray-50 border border-[rgba(0,0,0,0.07)] text-gray-700'
                  }`}>
                    {msg.content}
                  </div>
                  {(msg as any).action && (
                    <button
                      onClick={() => navigate((msg as any).action.path)}
                      className="mt-1 text-[11px] text-[#3ECF8E] hover:underline flex items-center gap-1"
                    >
                      Go to page <ArrowRight size={10} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] mr-12">
                  <div className="px-3 py-2 rounded-xl bg-gray-50 border border-[rgba(0,0,0,0.07)]">
                    <Loader size={13} className="animate-spin text-gray-400" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !chatLoading && sendChat()}
              placeholder="Ask about recovery, inventory, LOT performance..."
              className="flex-1 px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E]"
            />
            <button
              onClick={sendChat}
              disabled={chatLoading || !chatInput.trim()}
              className="px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-xl transition-colors disabled:opacity-60"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.06)] flex items-center gap-2">
            <History size={12} className="text-gray-500" />
            <h3 className="text-[13px] font-semibold text-gray-900">AI Run History</h3>
            <span className="ml-auto text-[12px] text-gray-400">{aiRuns.length} recent runs</span>
          </div>
          {aiRuns.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-gray-400">
              No AI runs yet. Use AI features above to see history here.
            </div>
          ) : (
            <div className="divide-y divide-[rgba(0,0,0,0.04)]">
              {aiRuns.map((run: any) => (
                <div
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/70 cursor-pointer transition-colors"
                >
                  <div className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    {run.status === 'completed' ? (
                      <CheckCircle size={12} className="text-[#16a34a]" />
                    ) : run.status === 'failed' ? (
                      <XCircle size={12} className="text-red-500" />
                    ) : (
                      <Loader size={12} className="text-gray-400 animate-spin" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-gray-900 capitalize">
                      {run.run_type.replace(/_/g, ' ')}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {new Date(run.created_at).toLocaleString()}
                      {run.entity_type && ` · ${run.entity_type}`}
                    </p>
                  </div>
                  <ArrowRight size={12} className="text-gray-400" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedRun && (
        <Modal
          open={true}
          onClose={() => setSelectedRunId(null)}
          title={`AI Run: ${selectedRun.run_type.replace(/_/g, ' ')}`}
          footer={
            <button onClick={() => setSelectedRunId(null)} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
              Close
            </button>
          }
        >
          <div className="space-y-3">
            <DetailRow label="Status" value={
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                selectedRun.status === 'completed' ? 'bg-[#ECFDF5] text-[#15803d]' :
                selectedRun.status === 'failed' ? 'bg-red-50 text-red-700' :
                'bg-yellow-50 text-yellow-700'
              }`}>
                {selectedRun.status}
              </span>
            } />
            <DetailRow label="Run Type" value={selectedRun.run_type} />
            {selectedRun.entity_type && <DetailRow label="Entity Type" value={selectedRun.entity_type} />}
            <DetailRow label="Created" value={new Date(selectedRun.created_at).toLocaleString()} />
            {selectedRun.output && (
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block uppercase tracking-wide">Output</label>
                <div className="bg-gray-950 rounded-lg p-3 overflow-x-auto max-h-64">
                  <pre className="text-[11px] text-emerald-400 font-mono whitespace-pre-wrap">
                    {JSON.stringify(selectedRun.output, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
