import torch
import torch.nn as nn

class ConnectivityPredictor(nn.Module):
    def __init__(self, feature_dim: int = 3, hidden_dim: int = 64):
        super(ConnectivityPredictor, self).__init__()
        self.encoder = nn.TransformerEncoder(
            nn.TransformerEncoderLayer(d_model=feature_dim, nhead=1, dim_feedforward=hidden_dim, batch_first=True),
            num_layers=2
        )
        self.decoder = nn.Linear(feature_dim, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        encoded = self.encoder(x)
        prediction = torch.sigmoid(self.decoder(encoded[:, -1, :]))
        return prediction
