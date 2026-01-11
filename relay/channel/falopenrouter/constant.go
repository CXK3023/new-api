package falopenrouter

var ModelList = []string{}

var ChannelName = "falopenrouter"

// 需要智能 image_config 的模型（已测试过的）
var SmartImageConfigModels = []string{
	"google/gemini-3-pro-image-preview",
	"bytedance-seed/seedream-4.5",
}

// 已知的图像生成模型列表
var KnownImageModels = []string{
	"google/gemini-3-pro-image-preview",
	"google/gemini-2.5-flash-image",
	"google/gemini-2.5-flash-image-preview",
	"bytedance-seed/seedream-4.5",
	"openai/gpt-5-image",
	"openai/gpt-5-image-mini",
	"black-forest-labs/flux.2-max",
	"black-forest-labs/flux.2-flex",
	"black-forest-labs/flux.2-pro",
	"sourceful/riverflow-v2-max-preview",
	"sourceful/riverflow-v2-standard-preview",
	"sourceful/riverflow-v2-fast-preview",
}

// 图像生成模型默认配置
type ImageModelDefaults struct {
	ImageSize   string
	AspectRatio string
}

var DefaultImageConfig = ImageModelDefaults{
	ImageSize:   "4K",
	AspectRatio: "1:1",
}
