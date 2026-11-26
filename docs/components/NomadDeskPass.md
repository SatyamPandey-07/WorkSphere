# NomadDeskPass

## Implementation status

The requested component implementation,
`src/components/bookings/NomadDeskPass.tsx`, is not present in this workspace.
Because there is no implemented `NomadDeskPass` component to inspect, this
document cannot accurately define its props or missing-address fallback copy
without inventing behavior.

Nomad Desk Pass documentation must not describe an address fallback until the
component implementation exists and provides all of the following:

- the fallback text rendered when `venue.address` is `null`;
- the fallback text rendered when `venue.address` is omitted;
- the exact prop names for the booking and location data;
- any use of neighborhood, city, or other location metadata;
- the behavior when no usable location metadata remains.

## Usage example

A usage example for a missing venue address should be added together with the
component implementation, for example by passing a real booking object whose
`venue.address` is `null` or absent and then documenting the exact rendered
result. It must describe the component's actual props and output rather than
assuming a fallback label.
