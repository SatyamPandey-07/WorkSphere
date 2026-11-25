# WebRTC Media Track Controller Architecture

```mermaid
stateDiagram-v2
    [*] --> IdleMediaOnly: Room Initialized
    IdleMediaOnly --> ScreenSharing: startScreenShare(track)
    ScreenSharing --> IdleMediaOnly: stopScreenShare()
    ScreenSharing --> FallbackMediaOnly: NotAllowedError / OverconstrainedError / ended
    FallbackMediaOnly --> ScreenSharing: Retry startScreenShare(track)
    IdleMediaOnly --> [*]: dispose()
