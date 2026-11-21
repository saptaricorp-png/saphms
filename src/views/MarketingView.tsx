import React, { useMemo, useState } from 'react';
import { Camera, Compass, MapPin, Plus, X } from 'lucide-react';
import type {
  LimsDatabase,
  MarketingVisitRecord,
  StaffMember,
} from '../types/lims';
import { apiRequest } from '../api/client';

interface MarketingViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
}

const SAPTARI_MUNICIPALITIES = [
  'Bode Barsain Municipality',
  'Rajbiraj Municipality',
  'Khadak Municipality (Kalyanpur)',
  'Shambhunath Municipality',
  'Dakneshwori Municipality',
  'Kanchanrup Municipality',
  'Surunga Municipality',
  'Hanumannagar Kankalini Municipality',
  'Saptakoshi Municipality',
  'Rajgadh Rural Municipality',
];

export function MarketingView({ db, activeUser, onUpdated }: MarketingViewProps) {
  const [areaFilter, setAreaFilter] = useState('ALL');
  const [areaName, setAreaName] = useState('Bode Barsain Bazaar');
  const [municipality, setMunicipality] = useState(SAPTARI_MUNICIPALITIES[0]);
  const [facilityOrDoctorName, setFacilityOrDoctorName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [gpsLat, setGpsLat] = useState('');
  const [gpsLng, setGpsLng] = useState('');
  const [gpsAccuracy, setGpsAccuracy] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<MarketingVisitRecord['status']>('Logged');
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const areaStats = useMemo(() => {
    const map: Record<string, number> = {};
    for (const v of db.marketingVisits || []) {
      map[v.municipality] = (map[v.municipality] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [db.marketingVisits]);

  const filteredVisits = useMemo(() => {
    return (db.marketingVisits || []).filter(
      (v) => areaFilter === 'ALL' || v.municipality === areaFilter
    );
  }, [db.marketingVisits, areaFilter]);

  const handleCaptureGps = () => {
    if (!navigator.geolocation) {
      onUpdated(db, 'Geolocation is unavailable in this browser. Enter coordinates or pick Saptari hub.');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLat(pos.coords.latitude.toFixed(6));
        setGpsLng(pos.coords.longitude.toFixed(6));
        setGpsAccuracy(String(Math.round(pos.coords.accuracy)));
        setGpsLoading(false);
        onUpdated(db, 'Captured live GPS site coordinates.');
      },
      () => {
        // Fallback Saptari Bode Barsain coordinate hint when GPS hardware/permission is blocked
        setGpsLat('26.583300');
        setGpsLng('86.652400');
        setGpsAccuracy('35');
        setGpsLoading(false);
        onUpdated(db, 'GPS permission blocked; populated Bode Barsain field reference coordinates.');
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 640;
        const scale = img.width > maxW ? maxW / img.width : 1;
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.72));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const resp = await apiRequest<{ visit: MarketingVisitRecord; db: LimsDatabase }>(
        '/api/marketing/visits',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            areaName,
            municipality,
            facilityOrDoctorName,
            contactPerson,
            phone,
            gpsLat: gpsLat ? Number(gpsLat) : undefined,
            gpsLng: gpsLng ? Number(gpsLng) : undefined,
            gpsAccuracyM: gpsAccuracy ? Number(gpsAccuracy) : undefined,
            photoDataUrl: photoDataUrl || undefined,
            notes,
            status,
          }),
        }
      );
      onUpdated(resp.db, `Logged marketing field visit ${resp.visit.visitNumber} (${resp.visit.areaName}).`);
      setFacilityOrDoctorName('');
      setContactPerson('');
      setPhone('');
      setNotes('');
      setPhotoDataUrl('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to log marketing visit.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Area Field Marketing &amp; Referral Outreach (GPS + Site Photo)
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Track Saptari municipality field visits with live GPS geotagging and verified clinic/doctor site photos from web or Android field app.
          </p>
        </div>
        <div className="text-xs font-mono bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-slate-700">
          Logged Visits: <strong>{(db.marketingVisits || []).length}</strong>
        </div>
      </div>

      {/* Area Breakdown Strip */}
      {areaStats.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-700 mr-1">Filter by Area:</span>
          <button
            type="button"
            onClick={() => setAreaFilter('ALL')}
            className={`px-2.5 py-1 rounded-md border font-medium ${
              areaFilter === 'ALL' ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-700 border-slate-200'
            }`}
          >
            All ({(db.marketingVisits || []).length})
          </button>
          {areaStats.map(([muni, count]) => (
            <button
              key={muni}
              type="button"
              onClick={() => setAreaFilter(muni)}
              className={`px-2.5 py-1 rounded-md border font-medium ${
                areaFilter === muni ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              {muni} ({count})
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Field Visit Entry Form */}
        <form
          onSubmit={handleSubmit}
          className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs"
        >
          <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-2.5 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-600" />
            Log Field Site Visit (GPS &amp; Photo)
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block font-medium mb-1">Saptari Municipality / Rural Area *</label>
              <select
                value={municipality}
                onChange={(e) => setMunicipality(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                {SAPTARI_MUNICIPALITIES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Ward / Locality *</label>
              <input
                required
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Visit Outcome</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as MarketingVisitRecord['status'])}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                <option value="Logged">Logged</option>
                <option value="Follow-Up Required">Follow-Up Required</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block font-medium mb-1">Clinic / Pharmacy / Physician Visited *</label>
              <input
                required
                value={facilityOrDoctorName}
                onChange={(e) => setFacilityOrDoctorName(e.target.value)}
                placeholder="e.g., Shambhunath Poly Clinic / Dr. Sanjay Mandal"
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Contact Person</label>
              <input
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Phone</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98XXXXXXXX"
                className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* GPS Capture Strip */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">Site GPS Coordinates</span>
              <button
                type="button"
                onClick={handleCaptureGps}
                disabled={gpsLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700"
              >
                <Compass className="w-3 h-3" />
                {gpsLoading ? 'Locating...' : 'Capture Live GPS'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono">
              <input
                value={gpsLat}
                onChange={(e) => setGpsLat(e.target.value)}
                placeholder="Lat (26.58)"
                className="px-2 py-1 border border-slate-300 rounded bg-white"
              />
              <input
                value={gpsLng}
                onChange={(e) => setGpsLng(e.target.value)}
                placeholder="Lng (86.65)"
                className="px-2 py-1 border border-slate-300 rounded bg-white"
              />
              <input
                value={gpsAccuracy}
                onChange={(e) => setGpsAccuracy(e.target.value)}
                placeholder="Acc (m)"
                className="px-2 py-1 border border-slate-300 rounded bg-white"
              />
            </div>
          </div>

          {/* Site Photo Upload */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-blue-600" />
                Site Visit Photo Upload
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                className="text-[11px] text-slate-600"
              />
            </label>
            {photoDataUrl && (
              <div className="relative w-32 h-20 rounded border border-slate-300 overflow-hidden">
                <img src={photoDataUrl} alt="Site preview" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotoDataUrl('')}
                  className="absolute top-1 right-1 bg-slate-900/75 text-white p-0.5 rounded"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block font-medium mb-1">Field Discussion Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Diagnostic brochure shared, OPD referral tie-up discussed..."
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {submitting ? 'Saving Site Visit...' : 'Save Marketing Field Visit'}
          </button>
        </form>

        {/* Logged Visits Table */}
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
            Field Marketing Visit Log ({filteredVisits.length})
          </div>
          <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
            {filteredVisits.map((v) => (
              <div key={v.id} className="p-4 flex items-start justify-between gap-4 text-xs hover:bg-slate-50/70">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-blue-700">{v.visitNumber}</span>
                    <span className="font-semibold text-slate-900">{v.facilityOrDoctorName}</span>
                    <span className="font-mono text-slate-500">· {v.bsDate}</span>
                  </div>
                  <div className="text-slate-700">
                    <strong>{v.municipality}</strong> ({v.areaName}) · Contact: {v.contactPerson}{' '}
                    {v.phone ? `(${v.phone})` : ''}
                  </div>
                  {v.notes && <div className="text-slate-600">{v.notes}</div>}
                  <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-500">
                    <span>Rep: {v.staffName}</span>
                    {v.gpsLat !== undefined && v.gpsLng !== undefined && (
                      <span className="text-emerald-700">
                        GPS: {v.gpsLat.toFixed(5)}, {v.gpsLng.toFixed(5)}
                        {v.gpsAccuracyM ? ` (±${v.gpsAccuracyM}m)` : ''}
                      </span>
                    )}
                    <span className={v.status === 'Follow-Up Required' ? 'text-amber-700 font-semibold' : 'text-slate-600'}>
                      {v.status}
                    </span>
                  </div>
                </div>
                {v.photoDataUrl && (
                  <button
                    type="button"
                    onClick={() => setPreviewPhoto(v.photoDataUrl || null)}
                    className="w-20 h-14 rounded-lg border border-slate-200 overflow-hidden shrink-0"
                    title="View full site photo"
                  >
                    <img src={v.photoDataUrl} alt={v.facilityOrDoctorName} className="w-full h-full object-cover" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <div className="relative max-w-2xl bg-white rounded-xl p-2 shadow-2xl">
            <img src={previewPhoto} alt="Field Site" className="max-h-[80vh] rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
