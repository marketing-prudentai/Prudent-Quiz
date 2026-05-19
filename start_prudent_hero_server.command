#!/bin/zsh
cd "$(dirname "$0")"

if [[ -z "$OPENAI_API_KEY" ]]; then
  printf "OpenAI API key: "
  stty -echo
  read OPENAI_API_KEY
  stty echo
  printf "\n"
  export OPENAI_API_KEY
fi

node prudent_hero_server.mjs
