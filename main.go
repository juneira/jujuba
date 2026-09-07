package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
	"github.com/juneira/jujuba/chat"
	"github.com/juneira/jujuba/openai"
)

const defaultModelID = "deepseek/deepseek-v4-flash-0731"

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Fatal("Error loading .env file")
	}

	baseURL := os.Getenv("OPENAI_BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:1234"
	}

	modelID := os.Getenv("MODEL_ID")
	if modelID == "" {
		modelID = defaultModelID
	}

	apiKey := os.Getenv("OPENAI_API_KEY")
	stream := isTruthy(os.Getenv("STREAM"))

	client := openai.NewClient(baseURL, apiKey)

	c := chat.New(client, modelID)

	scanner := bufio.NewScanner(os.Stdin)

	for {
		fmt.Print("USER > ")

		scanner.Scan()
		input := scanner.Text()

		fmt.Print("BOT > ")
		var resp string
		var err error
		if stream {
			resp, err = c.AskStream(input, func(delta string) {
				fmt.Print(delta)
			})
			fmt.Println()
		} else {
			resp, err = c.Ask(input)
			fmt.Println(resp)
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	}
}

func isTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes":
		return true
	}
	return false
}
