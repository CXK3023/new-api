package falopenrouter

// ImageConfig fal.ai 图像生成配置
type ImageConfig struct {
	ImageSize   string `json:"image_size,omitempty"`
	AspectRatio string `json:"aspect_ratio,omitempty"`
}

// RequestReasoning OpenRouter reasoning 配置
type RequestReasoning struct {
	Enabled bool `json:"enabled,omitempty"`
	Effort  string `json:"effort,omitempty"` // "high", "medium", "low"
}
