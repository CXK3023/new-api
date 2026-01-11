package falopenrouter

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

type Adaptor struct {
	openai.Adaptor
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
	a.Adaptor.Init(info)
	a.Adaptor.ChannelType = constant.ChannelTypeFalOpenRouter
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	// FalOpenRouter 使用标准的 OpenAI 路径格式
	return relaycommon.GetFullRequestURL(info.ChannelBaseUrl, info.RequestURLPath, info.ChannelType), nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, header *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, header)
	// fal.ai 使用 "Key" 而不是 "Bearer"
	header.Set("Authorization", "Key "+info.ApiKey)
	header.Set("Content-Type", "application/json")
	return nil
}

func (a *Adaptor) ConvertRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}

	// 处理思考模型路由
	request = applyThinkingModelRouting(request)

	// 为图像生成模型添加 modalities 参数和智能 image_config
	if isImageGenerationModel(request.Model) {
		if request.Modalities == nil || len(request.Modalities) == 0 {
			// 将 modalities 设置为 JSON
			modalities := []string{"image", "text"}
			if modalitiesJSON, err := json.Marshal(modalities); err == nil {
				request.Modalities = modalitiesJSON
			}
		}
		// 应用智能 image_config（暂不实现，因为需要修改 dto 结构）
		// if err := applySmartImageConfig(request); err != nil {
		// 	return nil, err
		// }
	}

	return request, nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	return a.ConvertRequest(c, info, request)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	// 使用父类的响应处理，但需要处理图像响应格式转换
	if info.RelayMode == relayconstant.RelayModeImagesGenerations {
		return a.handleImageResponse(c, resp, info)
	}
	return a.Adaptor.DoResponse(c, resp, info)
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}

// applyThinkingModelRouting 处理思考模型路由
// 将 xxx-thinking 模型路由到实际模型并开启 reasoning
func applyThinkingModelRouting(request *dto.GeneralOpenAIRequest) *dto.GeneralOpenAIRequest {
	model := request.Model

	// 通用规则：如果模型名以 -thinking 结尾（不区分大小写），自动处理
	if strings.HasSuffix(strings.ToLower(model), "-thinking") {
		actualModel := model[:len(model)-len("-thinking")]
		request.Model = actualModel

		// 构建 reasoning 参数
		reasoning := RequestReasoning{
			Enabled: true,
		}
		if marshal, err := json.Marshal(reasoning); err == nil {
			request.Reasoning = marshal
		}
	}

	return request
}

// isImageGenerationModel 判断是否是图像生成模型
func isImageGenerationModel(model string) bool {
	if model == "" {
		return false
	}
	modelLower := strings.ToLower(model)

	// 检查已知图像模型列表
	for _, m := range KnownImageModels {
		if strings.ToLower(m) == modelLower {
			return true
		}
	}

	// 通用规则：模型名包含关键词
	keywords := []string{"-image", "image-", "seedream", "flux", "riverflow"}
	for _, keyword := range keywords {
		if strings.Contains(modelLower, keyword) {
			return true
		}
	}

	return false
}

// applySmartImageConfig 应用智能 image_config
// 注意：由于 dto.GeneralOpenAIRequest 没有 ImageConfig 字段，此功能暂时禁用
// 如需启用，需要在 dto 中添加 ImageConfig json.RawMessage `json:"image_config,omitempty"`
func applySmartImageConfig(request *dto.GeneralOpenAIRequest) error {
	// 功能暂时禁用
	return nil

	/*
	// 只对已测试的模型应用智能配置
	modelLower := strings.ToLower(request.Model)
	shouldApply := false
	for _, m := range SmartImageConfigModels {
		if strings.ToLower(m) == modelLower {
			shouldApply = true
			break
		}
	}

	if !shouldApply {
		return nil
	}

	// 从提示词解析配置
	promptConfig := parseImageConfigFromPrompt(request.Messages)

	// 解析现有的 image_config
	var existingConfig ImageConfig
	if request.ImageConfig != nil {
		if err := json.Unmarshal(request.ImageConfig, &existingConfig); err == nil {
			// 使用现有配置
		}
	}

	// 合并配置（优先级: 提示词 > 请求参数 > 默认值）
	finalConfig := ImageConfig{
		ImageSize:   DefaultImageConfig.ImageSize,
		AspectRatio: DefaultImageConfig.AspectRatio,
	}

	// 应用请求参数中的配置
	if existingConfig.ImageSize != "" {
		finalConfig.ImageSize = existingConfig.ImageSize
	}
	if existingConfig.AspectRatio != "" {
		finalConfig.AspectRatio = existingConfig.AspectRatio
	}

	// 应用提示词中的配置（最高优先级）
	if promptConfig.ImageSize != "" {
		finalConfig.ImageSize = promptConfig.ImageSize
	}
	if promptConfig.AspectRatio != "" {
		finalConfig.AspectRatio = promptConfig.AspectRatio
	}

	// 序列化为 JSON
	if marshal, err := json.Marshal(finalConfig); err == nil {
		request.ImageConfig = marshal
	}

	return nil
	*/
}

// parseImageConfigFromPrompt 从提示词中解析 image_config 参数
func parseImageConfigFromPrompt(messages []dto.Message) ImageConfig {
	config := ImageConfig{}

	if len(messages) == 0 {
		return config
	}

	// 获取最后一条用户消息
	var lastUserMessage string
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			if messages[i].StringContent() != "" {
				lastUserMessage = messages[i].StringContent()
				break
			}
		}
	}

	if lastUserMessage == "" {
		return config
	}

	content := lastUserMessage
	contentLower := strings.ToLower(content)

	// 检测分辨率关键词
	if match, _ := regexp.MatchString(`\b4k\b`, contentLower); match {
		config.ImageSize = "4K"
	} else if match, _ := regexp.MatchString(`\b2k\b`, contentLower); match {
		config.ImageSize = "2K"
	} else if match, _ := regexp.MatchString(`\b1k\b`, contentLower); match {
		config.ImageSize = "1K"
	}

	// 检测宽高比关键词 - 精确比例
	if match, _ := regexp.MatchString(`16[:：]9`, content); match {
		config.AspectRatio = "16:9"
	} else if match, _ := regexp.MatchString(`9[:：]16`, content); match {
		config.AspectRatio = "9:16"
	} else if match, _ := regexp.MatchString(`1[:：]1`, content); match {
		config.AspectRatio = "1:1"
	} else if match, _ := regexp.MatchString(`4[:：]3`, content); match {
		config.AspectRatio = "4:3"
	} else if match, _ := regexp.MatchString(`3[:：]4`, content); match {
		config.AspectRatio = "3:4"
	} else if match, _ := regexp.MatchString(`3[:：]2`, content); match {
		config.AspectRatio = "3:2"
	} else if match, _ := regexp.MatchString(`2[:：]3`, content); match {
		config.AspectRatio = "2:3"
	} else {
		// 语义关键词
		if match, _ := regexp.MatchString(`横(屏|版|图)|landscape|widescreen|宽屏`, contentLower); match {
			config.AspectRatio = "16:9"
		} else if match, _ := regexp.MatchString(`竖(屏|版|图)|portrait|vertical|手机壁纸`, contentLower); match {
			config.AspectRatio = "9:16"
		} else if match, _ := regexp.MatchString(`方(形|图)|square|正方`, contentLower); match {
			config.AspectRatio = "1:1"
		}
	}

	return config
}

// handleImageResponse 处理图像响应，转换为 Markdown 格式
func (a *Adaptor) handleImageResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	// 读取响应体
	responseBody, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("failed to read response: %v", readErr),
			types.ErrorCodeReadResponseBodyFailed,
			resp.StatusCode,
		)
	}

	// 解析为 OpenAI 响应格式
	var openaiResp dto.OpenAITextResponse
	if parseErr := json.Unmarshal(responseBody, &openaiResp); parseErr != nil {
		// 如果解析失败，直接返回原始响应
		c.Data(resp.StatusCode, "application/json", responseBody)
		return nil, nil
	}

	// 转换图像格式
	transformImageResponse(&openaiResp)

	// 返回转换后的响应
	c.JSON(resp.StatusCode, openaiResp)

	// 返回使用信息
	return &openaiResp.Usage, nil
}

// transformImageResponse 转换图像生成响应
// 将非标准的 images 字段转换为 Markdown 图片格式
func transformImageResponse(data *dto.OpenAITextResponse) {
	if data == nil || len(data.Choices) == 0 {
		return
	}

	for i := range data.Choices {
		message := &data.Choices[i].Message

		// 检查是否有 images 字段（需要扩展 dto.Message 结构）
		// 由于原始 dto.Message 可能没有 images 字段，这里我们需要通过其他方式处理
		// 暂时跳过这个转换，因为需要修改 dto 结构
		_ = message
	}
}
