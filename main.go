package main

import (
	"bufio"
	"fmt"
	"os"

	"github.com/juneira/jujuba/chat"
	"github.com/juneira/jujuba/openai"
)

const defaultModelID = "deepseek/deepseek-v4-flash-0731"

func main() {
	baseURL := os.Getenv("OPENAI_BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:1234"
	}

	modelID := os.Getenv("MODEL_ID")
	if modelID == "" {
		modelID = defaultModelID
	}

	apiKey := os.Getenv("OPENAI_API_KEY")

	client := openai.NewClient(baseURL, apiKey)

	c := chat.New(client, modelID)

	scanner := bufio.NewScanner(os.Stdin)

	for {
		fmt.Print("USER > ")

		scanner.Scan()
		resp, err := c.Ask(scanner.Text())
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("BOT >", resp)
	}

}
