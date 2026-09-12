package com.app;
import com.bar.ApiClient;
public class OtherService {
    public String run() { return new ApiClient().request(); }
}
