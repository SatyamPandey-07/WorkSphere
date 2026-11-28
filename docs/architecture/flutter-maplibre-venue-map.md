# Flutter MapLibre venue map

The venue discovery map is implemented by `VenueMapView` and
`VenueMapController` in `apps/flutter/lib/features/venue_discovery/`. It
renders venue markers as Flutter widgets over the MapLibre map and groups
nearby venues with a zoom-scaled hexagonal grid.

## Clustering configuration

The implementation does not configure a circular cluster radius or zoom
thresholds for cluster formation and expansion. Instead,
`VenueMapController.clusterVenues` projects coordinates to Web Mercator
world-pixel coordinates, scales them for the current zoom, divides by a
hexagonal grid cell size, and rounds each point into a cell. A cell containing
more than one valid venue is shown as a cluster; a cell containing one is
shown as an individual marker.

| Setting | Value | Effect |
|---|---:|---|
| `cellSize` default in `clusterVenues` | `52` projected map pixels | Hexagonal grid cell size; it is not a circular radius. |
| World scale base | `256` pixels | The scale is `256 * 2^zoom`, so the same geographic distance spans more world pixels at higher zoom. |
| Initial camera zoom | `2` | Starting zoom when the MapLibre map is created. |
| Cluster-tap zoom increment | `2` zoom levels | Added to the controller's current zoom when a cluster is tapped. |
| Cluster-tap zoom ceiling | `18` | The target zoom for a cluster tap is `min(currentZoom + 2, 18)`. This is not a general map or clustering maximum. |
| Map viewport fetch debounce | `350 ms` | Default delay after viewport/zoom updates before fetching venues for that viewport. |

There is no application-defined minimum zoom, general maximum zoom, or
cluster-count limit in `clusterVenues`. The map does not switch behavior at a
fixed zoom threshold: changing zoom changes the projected spacing between
venues relative to the 52-pixel grid. Zooming in usually separates venues into
single-marker cells; zooming out usually puts more venues in the same cells.
An individual marker is displayed whenever its grid cell contains exactly one
venue.

Venues without coordinates, with latitude outside `-85.0511` to `85.0511`, or
with longitude outside `-180` to `180` are excluded from clusters. The
controller uses the arithmetic mean of cluster-member latitudes and
longitudes for the cluster marker position.

Other `VenueMapView` defaults are:

| Setting | Default |
|---|---|
| `styleUrl` | `WORKSPHERE_MAP_STYLE_URL` compile-time value, or `https://tiles.openfreemap.org/styles/liberty` when unset. |
| `debounceDuration` | `Duration(milliseconds: 350)` |

An empty or whitespace-only style URL displays the map-unavailable state.

## Marker taps and venue selection

There is no public marker-tap callback parameter on `VenueMapView`. Each
rendered marker has a `GestureDetector` whose `onTap` invokes the internal
`_selectCluster(VenueMapCluster cluster)` handler. Its argument represents the
tapped marker and contains the grid-cell `id`, the member `venues`, and the
marker latitude and longitude.

- For an individual marker, `cluster.venues` contains one venue. The handler
  calls `VenueMapController.selectVenue` with that venue.
- For a cluster marker, the handler calls `selectCluster` with all member
  venues, then animates the map to the cluster coordinates while increasing
  zoom by two levels, capped at 18.

The controller's `selectedVenues` records the selected venue or cluster
members. This is map selection state; it is not a callback to the parent
screen. Venue selection in the list uses the separate `onVenueTap` callback
on `VenueDiscoveryScreen`.

## Bottom-sheet preview

After either marker type is tapped, `_selectCluster` opens a
`showModalBottomSheet` and passes it the marker's `cluster.venues` and
`cluster.isCluster` value. An individual marker therefore previews its one
venue; a cluster previews all venues in that cluster. The sheet title is
“Venue preview” for an individual marker and “N nearby venues” for a cluster.
Each row displays the venue name and a subtitle containing its non-empty
address, open-status label, WiFi label, and noise label.

The sheet is scroll-controlled and shows a drag handle. When it is dismissed,
its `whenComplete` callback calls `VenueMapController.clearSelection`.
Tapping a cluster also starts its zoom animation; tapping an individual marker
does not animate the camera.

Event flow:

```text
marker tap
  -> _selectCluster(VenueMapCluster)
  -> update selected venue(s)
  -> for a cluster, animate to its center and zoom +2 (up to 18)
  -> show preview sheet with the cluster's venues
  -> dismiss sheet -> clear selection
```

## Map gestures and viewport updates

The `MapLibreMap` configuration enables scroll/pan, zoom, and rotation
gestures; tilt gestures are disabled. The compass is enabled. Markers are
positioned in an overlay using the visible viewport and their projected
coordinates.

Tapping a marker overlay invokes its marker handler described above. A
multi-venue cluster tap both opens its preview sheet and requests the zoom
animation; an individual marker tap opens its preview only. There is no
configured callback for tapping an empty area of the map.

When the camera becomes idle, `onCameraIdle` reads the visible map region and
camera zoom, updates the controller viewport, and schedules a debounced
venue fetch. The controller reclusters the current venue results using that
zoom. Panning and zooming therefore change the fetched viewport and marker
grouping without introducing a separate gesture-specific callback.
