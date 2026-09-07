package main

import (
	"bufio"
	"fmt"
	"os"

	"github.com/juneira/jujuba/chat"
	"github.com/juneira/jujuba/openai"
)

func main() {
	client := openai.NewClient("http://localhost:1234")
	c := chat.New(client, "llama-3")

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
