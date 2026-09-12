package com.app;
import com.foo.ApiClient;
public class Service {
    public String run() { return new ApiClient().request(); }
}
