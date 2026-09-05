"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { INSTAGRAM_WEBSITE_STATUS_LABEL, type DiscoveredBusiness } from "@/lib/api";
import { hasCoordinates, type LocatedBusiness } from "@/lib/filters";

// Leaflet's default marker asset paths break under a bundler, so every
// pin is an inline SVG divIcon instead — no external image requests.
function pinIcon(selected: boolean, noWebsite: boolean): L.DivIcon {
  const fill = selected ? "#2563eb" : noWebsite ? "#ea580c" : "#94a3b8";
  const size = selected ? 30 : 24;
  return L.divIcon({
    className: "discovery-map-pin",
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="white" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white" stroke="none"/></svg>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 2],
  });
}

type Located = LocatedBusiness;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function popupHtml(b: Located): string {
  const category = b.business_category || b.industry;
  const cat = category ? ` · ${esc(category)}` : "";
  const handle = b.instagram_handle
    ? `<br/><a href="${esc(b.instagram_profile_url ?? `https://instagram.com/${b.instagram_handle}`)}" target="_blank" rel="noreferrer">@${esc(b.instagram_handle)}</a>`
    : "";
  const addr = b.address ? `<br/>${esc(b.address)}` : b.suburb ? `<br/>${esc(b.suburb)}` : "";
  const phone = b.phone ? `<br/><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>` : "";
  const site =
    b.website_status === "found" && b.website_url
      ? `<br/><a href="${esc(b.website_url)}" target="_blank" rel="noreferrer">${esc(b.website_url)}</a>`
      : b.website_status === "none"
        ? `<br/><em>${b.instagram_website_status ? esc(INSTAGRAM_WEBSITE_STATUS_LABEL[b.instagram_website_status]) : "No website"}</em>`
        : "";
  const details = `<br/><a href="/dashboard/discovered-businesses/${b.id}">View details &rarr;</a>`;
  return `<strong>${esc(b.name)}</strong>${cat}${handle}${addr}${phone}${site}${details}`;
}

const noWebsite = (b: Located) => b.website_status === "none";

export default function DiscoveryMap({
  businesses,
  selectedId,
  onSelect,
}: {
  businesses: DiscoveredBusiness[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const fittedSignatureRef = useRef<string>("");
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const located = useMemo<Located[]>(() => businesses.filter(hasCoordinates), [businesses]);

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const markers = markersRef.current;
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([-25.3, 133.8], 3);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    // Nearby businesses collapse into a counted cluster bubble — the
    // point of the map for in-person prospecting is spotting where the
    // density is.
    const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
    map.addLayer(cluster);
    mapRef.current = map;
    clusterRef.current = cluster;
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      markers.clear();
      fittedSignatureRef.current = "";
    };
  }, []);

  // Keep the markers in step with the visible (filtered) result set.
  useEffect(() => {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;

    const wanted = new Set(located.map((b) => b.id));
    for (const [id, marker] of markersRef.current) {
      if (!wanted.has(id)) {
        cluster.removeLayer(marker);
        markersRef.current.delete(id);
      }
    }
    for (const b of located) {
      let marker = markersRef.current.get(b.id);
      if (!marker) {
        marker = L.marker([b.latitude, b.longitude], { icon: pinIcon(false, noWebsite(b)) });
        marker.bindPopup(popupHtml(b));
        marker.on("click", () => onSelectRef.current(b.id));
        markersRef.current.set(b.id, marker);
        cluster.addLayer(marker);
      } else {
        marker.setLatLng([b.latitude, b.longitude]);
        marker.setPopupContent(popupHtml(b));
        marker.setIcon(pinIcon(b.id === selectedId, noWebsite(b)));
      }
    }

    const signature = [...wanted].sort().join(",");
    if (signature !== fittedSignatureRef.current && !selectedId && markersRef.current.size > 0) {
      map.fitBounds(cluster.getBounds().pad(0.2), { maxZoom: 15 });
      fittedSignatureRef.current = signature;
    }
  }, [located, selectedId]);

  // Reflect the current selection: highlight + reveal + focus its marker.
  useEffect(() => {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;
    for (const [id, marker] of markersRef.current) {
      const b = located.find((x) => x.id === id);
      marker.setIcon(pinIcon(id === selectedId, b ? noWebsite(b) : false));
    }
    if (selectedId) {
      const marker = markersRef.current.get(selectedId);
      if (marker) {
        cluster.zoomToShowLayer(marker, () => {
          map.setView(marker.getLatLng(), Math.max(map.getZoom(), 14), { animate: true });
          marker.openPopup();
        });
      }
    }
  }, [selectedId, located]);

  return (
    <div className="relative mt-4">
      <div
        ref={containerRef}
        className="h-72 w-full overflow-hidden rounded-md border border-border sm:h-80"
        aria-label="Map of discovered business locations"
      />
      {located.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-border bg-surface-subtle px-3 py-1.5 text-center text-xs text-fg-muted">
          No mapped locations in view — a business is pinned once its own site publishes map coordinates.
        </div>
      )}
    </div>
  );
}
