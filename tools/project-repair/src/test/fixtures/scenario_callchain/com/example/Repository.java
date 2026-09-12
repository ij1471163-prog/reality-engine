package com.example;
public class Repository {
    private ApiClient client = new ApiClient();
    public String authenticate() {
        return client.request();
    }
}
