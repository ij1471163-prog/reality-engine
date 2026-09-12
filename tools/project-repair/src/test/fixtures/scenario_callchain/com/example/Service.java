package com.example;
public class Service {
    private final Repository repository = new Repository();
    public String login() {
        return repository.authenticate();
    }
}
